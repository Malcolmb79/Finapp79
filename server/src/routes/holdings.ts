import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Investment holdings.
 *
 * Shaped after `policies.ts`, which solved the same problem: something that
 * has a value, whose value changes, and whose history has to be kept rather
 * than overwritten — because a net worth trend that projects today's price
 * backwards is a trend that invents the past.
 *
 * What is deliberately absent is a market data feed. Prices are entered or
 * pasted in, which is the same contract as every other figure here: nothing
 * is written that its owner has not seen. A feed is a sensible thing to add
 * later behind this same shape.
 */
export const holdingsRouter = Router();
holdingsRouter.use(requireAuth);

const KINDS = new Set(["equity", "fund", "bond", "crypto", "other"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const BOUNDS = {
  quantity: { min: 0, max: 1_000_000_000 },
  unit_cost: { min: 0, max: 10_000_000 },
  unit_price: { min: 0, max: 10_000_000 },
};

function badNumber(value: unknown, bounds: { min: number; max: number }): boolean {
  return typeof value !== "number" || !Number.isFinite(value) || value < bounds.min || value > bounds.max;
}

/** Holdings with their price history attached, newest price last. */
async function listHoldings(userId: string): Promise<(Record<string, unknown> & { id: string })[]> {
  const holdings = (await db
    .prepare("SELECT * FROM holdings WHERE user_id = ? ORDER BY created_at")
    .all(userId)) as unknown as (Record<string, unknown> & { id: string })[];

  if (holdings.length === 0) return [];

  // One query for every price rather than one per holding — the same
  // reasoning as the policies list, at the same scale.
  const prices = (await db
    .prepare("SELECT holding_id, priced_at, unit_price FROM holding_prices WHERE user_id = ? ORDER BY priced_at")
    .all(userId)) as unknown as { holding_id: string }[];

  return holdings.map((holding) => ({
    ...holding,
    prices: prices.filter((price) => price.holding_id === holding.id),
  }));
}

holdingsRouter.get("/", async (req, res) => {
  res.json(await listHoldings(req.user!.id));
});

holdingsRouter.post("/", async (req, res) => {
  const { name, ticker, kind, quantity, unit_cost, currency, unit_price, priced_at } = req.body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Give the holding a name." });
    return;
  }
  if (badNumber(quantity, BOUNDS.quantity)) {
    res.status(400).json({ error: "Quantity has to be a number, zero or more." });
    return;
  }
  if (unit_cost != null && badNumber(unit_cost, BOUNDS.unit_cost)) {
    res.status(400).json({ error: "Unit cost has to be a number, or left blank." });
    return;
  }
  const holdingKind = typeof kind === "string" && KINDS.has(kind) ? kind : "equity";

  const holding = (await db
    .prepare(
      `INSERT INTO holdings (id, user_id, name, ticker, kind, quantity, unit_cost, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      randomUUID(),
      req.user!.id,
      name.trim(),
      typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase() : null,
      holdingKind,
      quantity,
      unit_cost ?? null,
      typeof currency === "string" && /^[A-Z]{3}$/.test(currency.toUpperCase()) ? currency.toUpperCase() : "EUR"
    )) as unknown as { id: string };

  // A holding with no price is worth nothing to every total that reads it, so
  // the opening price rides along with the creation rather than being a
  // second step somebody can forget.
  if (!badNumber(unit_price, BOUNDS.unit_price)) {
    await db
      .prepare("INSERT INTO holding_prices (id, user_id, holding_id, priced_at, unit_price) VALUES (?, ?, ?, ?, ?)")
      .run(
        randomUUID(),
        req.user!.id,
        holding.id,
        typeof priced_at === "string" && ISO_DATE.test(priced_at) ? priced_at : new Date().toISOString().slice(0, 10),
        unit_price
      );
  }

  res.status(201).json((await listHoldings(req.user!.id)).find((h) => h.id === holding.id));
});

holdingsRouter.patch("/:id", async (req, res) => {
  const existing = await db.prepare("SELECT id FROM holdings WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "No such holding." });
    return;
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  // Only fields actually present are touched, the same rule the transactions
  // PATCH follows — so a cost basis can be cleared back to null rather than
  // that being indistinguishable from "left alone".
  if ("name" in req.body) {
    if (typeof req.body.name !== "string" || !req.body.name.trim()) {
      res.status(400).json({ error: "Give the holding a name." });
      return;
    }
    sets.push("name = ?");
    params.push(req.body.name.trim());
  }
  if ("ticker" in req.body) {
    sets.push("ticker = ?");
    params.push(typeof req.body.ticker === "string" && req.body.ticker.trim() ? req.body.ticker.trim().toUpperCase() : null);
  }
  if ("kind" in req.body && typeof req.body.kind === "string" && KINDS.has(req.body.kind)) {
    sets.push("kind = ?");
    params.push(req.body.kind);
  }
  for (const [field, bounds] of [
    ["quantity", BOUNDS.quantity],
    ["unit_cost", BOUNDS.unit_cost],
  ] as const) {
    if (!(field in req.body)) continue;
    const value = req.body[field];
    if (value !== null && badNumber(value, bounds)) {
      res.status(400).json({ error: `${field} has to be a number between ${bounds.min} and ${bounds.max}, or null.` });
      return;
    }
    sets.push(`${field} = ?`);
    params.push(value);
  }

  if (sets.length > 0) {
    await db.prepare(`UPDATE holdings SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...params, req.params.id, req.user!.id);
  }

  res.json((await listHoldings(req.user!.id)).find((h) => h.id === req.params.id));
});

/**
 * Records what a unit is worth today, keeping every earlier price.
 *
 * Appended rather than overwritten, which is the whole reason the trend can
 * show a holding honestly: on any past date it is worth what it was priced at
 * then, not what it is priced at now.
 */
holdingsRouter.post("/:id/price", async (req, res) => {
  const existing = await db.prepare("SELECT id FROM holdings WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "No such holding." });
    return;
  }

  const { unit_price, priced_at } = req.body as Record<string, unknown>;
  if (badNumber(unit_price, BOUNDS.unit_price)) {
    res.status(400).json({ error: "Give a price per unit." });
    return;
  }
  const when = typeof priced_at === "string" && ISO_DATE.test(priced_at) ? priced_at : new Date().toISOString().slice(0, 10);

  // One price per day: pricing the same holding twice in an afternoon is a
  // correction, not two facts, and keeping both would make the trend
  // zig-zag on whichever happened to sort last.
  await db.prepare("DELETE FROM holding_prices WHERE holding_id = ? AND user_id = ? AND priced_at = ?").run(req.params.id, req.user!.id, when);
  await db
    .prepare("INSERT INTO holding_prices (id, user_id, holding_id, priced_at, unit_price) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), req.user!.id, req.params.id, when, unit_price as number);

  res.json((await listHoldings(req.user!.id)).find((h) => h.id === req.params.id));
});

holdingsRouter.delete("/:id", async (req, res) => {
  await db.prepare("DELETE FROM holding_prices WHERE holding_id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  await db.prepare("DELETE FROM holdings WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  res.status(204).end();
});
