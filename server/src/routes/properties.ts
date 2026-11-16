import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Property, held as an investment or lived in.
 *
 * Stores the facts and computes none of the metrics — equity, NOI, cap rate
 * and coverage are arithmetic over these columns and live on the client beside
 * the screen that shows them. There is nothing a server round trip would add
 * except a second place for the definitions to drift.
 *
 * Why this is not an account is on the table in schema.sql.
 */

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

const TYPES = new Set(["residence", "rental", "multi_family", "commercial", "land"]);
const NET_WORTH_SOURCES = new Set(["none", "equity", "value"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bounds wide enough for any real property and narrow enough to catch a slip.
 *
 * A mistyped market value is not a cosmetic problem here: it drives equity,
 * the cap rate and whatever the property contributes to net worth, and a
 * figure with an extra zero on it reads exactly like a correct one.
 */
const BOUNDS: Record<string, { min: number; max: number }> = {
  purchase_price: { min: 0, max: 1_000_000_000 },
  market_value: { min: 0, max: 1_000_000_000 },
  mortgage_balance: { min: 0, max: 1_000_000_000 },
  mortgage_payment: { min: 0, max: 1_000_000 },
  monthly_rent: { min: 0, max: 1_000_000 },
  monthly_expenses: { min: 0, max: 1_000_000 },
  vacancy_rate: { min: 0, max: 100 },
};

/**
 * A money-ish field, or `undefined` to mean "refuse this request".
 *
 * Null is a real answer — "I do not know what it is worth" — and is kept
 * distinct from zero, which claims it is worth nothing. The metrics depend on
 * that distinction: an unknown value has no cap rate, while a value of zero
 * would have an infinite one.
 */
export function propertyNumber(raw: unknown, column: string): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "string" ? Number(raw.replace(/[,\s]/g, "")) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const bounds = BOUNDS[column];
  if (bounds && (value < bounds.min || value > bounds.max)) return undefined;
  return value;
}

const NUMERIC = [
  "purchase_price",
  "market_value",
  "mortgage_balance",
  "mortgage_payment",
  "monthly_rent",
  "monthly_expenses",
  "vacancy_rate",
] as const;

/**
 * The fields a write may set, validated, or null when the body is unusable.
 *
 * Shared by create and update so the two cannot disagree about what a valid
 * property is — the usual way a field ends up bounded on the way in and
 * unbounded on the way back.
 */
export function propertyPatch(body: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  if ("address" in body) {
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!address) return null;
    patch.address = address;
  }

  if ("property_type" in body) {
    if (typeof body.property_type !== "string" || !TYPES.has(body.property_type)) return null;
    patch.property_type = body.property_type;
  }

  if ("currency" in body) {
    if (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency.trim())) return null;
    patch.currency = body.currency.trim().toUpperCase();
  }

  if ("net_worth_source" in body) {
    if (typeof body.net_worth_source !== "string" || !NET_WORTH_SOURCES.has(body.net_worth_source)) return null;
    patch.net_worth_source = body.net_worth_source;
  }

  if ("purchase_date" in body) {
    const date = body.purchase_date;
    if (date !== null && (typeof date !== "string" || !ISO_DATE.test(date))) return null;
    patch.purchase_date = date;
  }

  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") return null;
    patch.notes = body.notes;
  }

  for (const column of NUMERIC) {
    if (!(column in body)) continue;
    const value = propertyNumber(body[column], column);
    if (value === undefined) return null;
    patch[column] = value;
  }

  return patch;
}

propertiesRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM properties WHERE user_id = ? ORDER BY created_at").all(req.user!.id));
});

propertiesRouter.post("/", async (req, res) => {
  const patch = propertyPatch(req.body ?? {});
  if (patch === null || !patch.address) {
    res.status(400).json({ error: "An address is required, and every figure has to be a plausible amount." });
    return;
  }

  const id = randomUUID();
  const columns = ["id", "user_id", ...Object.keys(patch)];
  const values = [id, req.user!.id, ...Object.values(patch)];
  const created = await db
    .prepare(
      `INSERT INTO properties (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`
    )
    .get(...values);

  res.status(201).json(created);
});

propertiesRouter.patch("/:id", async (req, res) => {
  const existing = await db
    .prepare("SELECT id FROM properties WHERE id = ? AND user_id = ?")
    .get<{ id: string }>(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "property not found" });
    return;
  }

  const patch = propertyPatch(req.body ?? {});
  if (patch === null) {
    res.status(400).json({ error: "One of those values isn't something a property can have." });
    return;
  }
  if (Object.keys(patch).length === 0) {
    res.json(await db.prepare("SELECT * FROM properties WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id));
    return;
  }

  const updated = await db
    .prepare(
      `UPDATE properties SET ${Object.keys(patch)
        .map((column) => `${column} = ?`)
        .join(", ")} WHERE id = ? AND user_id = ? RETURNING *`
    )
    .get(...Object.values(patch), req.params.id, req.user!.id);

  res.json(updated);
});

propertiesRouter.delete("/:id", async (req, res) => {
  const result = await db.prepare("DELETE FROM properties WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "property not found" });
    return;
  }
  res.status(204).send();
});
