import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Buy-to-let deals under appraisal.
 *
 * Stores the inputs and computes nothing: stamp duty, yields, cover and the
 * personal-versus-company comparison are all arithmetic over these columns and
 * live on the client beside the screen that shows them. A second
 * implementation on the server would be a second set of Irish tax rates to
 * keep current, and the one nobody is looking at is the one that goes stale.
 *
 * Why a deal is not a half-finished `properties` row is on the table in
 * schema.sql.
 */

export const btlDealsRouter = Router();
btlDealsRouter.use(requireAuth);

const OWNERSHIP = new Set(["personal", "company"]);

/**
 * Every writable field with the range it has to sit inside.
 *
 * A table rather than a wall of ifs, because there are twenty-five of them and
 * the failure mode of hand-written validation at that count is one field
 * quietly missing its bound. `min`/`max` are what a deal can plausibly state —
 * wide enough for a real purchase, narrow enough that a stray keystroke is
 * caught before it drives a yield.
 */
const NUMERIC: Record<string, { min: number; max: number }> = {
  purchase_price: { min: 0, max: 100_000_000 },
  ltv: { min: 0, max: 1 },
  mortgage_rate: { min: 0, max: 50 },
  term_years: { min: 1, max: 50 },
  arrangement_fees: { min: 0, max: 1_000_000 },
  purchase_fees: { min: 0, max: 1_000_000 },
  refurb_cost: { min: 0, max: 10_000_000 },
  value_after_works: { min: 0, max: 100_000_000 },
  furnishings_cost: { min: 0, max: 1_000_000 },
  units: { min: 1, max: 500 },
  rent_per_unit: { min: 0, max: 100_000 },
  vacancy_rate: { min: 0, max: 100 },
  management_rate: { min: 0, max: 100 },
  lpt_annual: { min: 0, max: 100_000 },
  insurance_monthly: { min: 0, max: 100_000 },
  maintenance_monthly: { min: 0, max: 100_000 },
  service_charge_monthly: { min: 0, max: 100_000 },
  rtb_fee_annual: { min: 0, max: 10_000 },
  other_monthly: { min: 0, max: 100_000 },
  marginal_rate: { min: 0, max: 1 },
  retained_share: { min: 0, max: 1 },
};

const BOOLEAN = ["interest_only", "apartment_block", "bulk_purchase", "rtb_registered"] as const;
const TEXT = ["address", "notes"] as const;

/** A number within its field's bounds, or `undefined` to mean "refuse this request". */
export function dealNumber(raw: unknown, column: string): number | undefined {
  const bounds = NUMERIC[column];
  if (!bounds) return undefined;
  const value = typeof raw === "string" ? Number(raw.replace(/[,\s]/g, "")) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < bounds.min || value > bounds.max) return undefined;
  return column === "units" ? Math.round(value) : value;
}

/**
 * The fields a write may set, validated, or null when the body is unusable.
 *
 * Shared by create and update, so the two cannot disagree about what a valid
 * deal is — the usual way a field ends up bounded on the way in and unbounded
 * on the way back.
 */
export function dealPatch(body: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return null;
    patch.name = name;
  }

  if ("currency" in body) {
    if (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency.trim())) return null;
    patch.currency = body.currency.trim().toUpperCase();
  }

  if ("ownership" in body) {
    if (typeof body.ownership !== "string" || !OWNERSHIP.has(body.ownership)) return null;
    patch.ownership = body.ownership;
  }

  for (const column of TEXT) {
    if (!(column in body)) continue;
    if (body[column] !== null && typeof body[column] !== "string") return null;
    patch[column] = body[column];
  }

  for (const column of BOOLEAN) {
    if (!(column in body)) continue;
    if (typeof body[column] !== "boolean") return null;
    patch[column] = body[column];
  }

  for (const column of Object.keys(NUMERIC)) {
    if (!(column in body)) continue;
    const value = dealNumber(body[column], column);
    if (value === undefined) return null;
    patch[column] = value;
  }

  return patch;
}

btlDealsRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM btl_deals WHERE user_id = ? ORDER BY created_at").all(req.user!.id));
});

btlDealsRouter.post("/", async (req, res) => {
  const patch = dealPatch(req.body ?? {});
  if (patch === null || !patch.name) {
    res.status(400).json({ error: "A name is required, and every figure has to be a plausible amount." });
    return;
  }

  const id = randomUUID();
  const columns = ["id", "user_id", ...Object.keys(patch)];
  const values = [id, req.user!.id, ...Object.values(patch)];
  res
    .status(201)
    .json(
      await db
        .prepare(`INSERT INTO btl_deals (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`)
        .get(...values)
    );
});

btlDealsRouter.patch("/:id", async (req, res) => {
  const existing = await db
    .prepare("SELECT id FROM btl_deals WHERE id = ? AND user_id = ?")
    .get<{ id: string }>(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "deal not found" });
    return;
  }

  const patch = dealPatch(req.body ?? {});
  if (patch === null) {
    res.status(400).json({ error: "One of those values isn't something a deal can have." });
    return;
  }
  if (Object.keys(patch).length === 0) {
    res.json(await db.prepare("SELECT * FROM btl_deals WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id));
    return;
  }

  res.json(
    await db
      .prepare(
        `UPDATE btl_deals SET ${Object.keys(patch)
          .map((column) => `${column} = ?`)
          .join(", ")} WHERE id = ? AND user_id = ? RETURNING *`
      )
      .get(...Object.values(patch), req.params.id, req.user!.id)
  );
});

btlDealsRouter.delete("/:id", async (req, res) => {
  const result = await db.prepare("DELETE FROM btl_deals WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "deal not found" });
    return;
  }
  res.status(204).send();
});
