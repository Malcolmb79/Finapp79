import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

budgetsRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT
         b.id,
         b.category_id,
         c.name AS category_name,
         b.monthly_limit,
         -- Reads the splits where a transaction has them and the transaction
         -- itself where it does not, so a shop that was half groceries counts
         -- half against the groceries budget. Grouping on t.category_id alone
         -- would count the whole thing, or none of it, and either way the
         -- budget would disagree with spending by category.
         COALESCE(SUM(CASE WHEN s.amount < 0 AND s.booking_date >= ? THEN -s.amount ELSE 0 END), 0) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       -- Each transaction as its category slices: its splits if it has any,
       -- otherwise one slice that is the transaction itself. The LEFT JOIN
       -- gives exactly that — one row per split, or one null-padded row for a
       -- transaction with none, which COALESCE turns back into the
       -- transaction. See services/splits.ts for why everything reads this way.
       LEFT JOIN (
         SELECT t.user_id, t.booking_date, t.reviewed_at,
                COALESCE(sp.category_id, t.category_id) AS category_id,
                COALESCE(sp.amount, t.amount) AS amount
           FROM transactions t
           LEFT JOIN transaction_splits sp ON sp.transaction_id = t.id
       ) s ON s.category_id = b.category_id AND s.user_id = b.user_id AND s.reviewed_at IS NOT NULL
       WHERE b.user_id = ?
       GROUP BY b.id, c.name
       ORDER BY c.name`
    )
    .all(monthStart(), req.user!.id);

  res.json(rows);
});

// Upsert: one budget per (user, category), so setting a new limit for a
// category that already has one just updates it rather than erroring.
budgetsRouter.post("/", async (req, res) => {
  const { category_id, monthly_limit } = req.body;
  if (!category_id || typeof monthly_limit !== "number" || monthly_limit <= 0) {
    res.status(400).json({ error: "category_id and a positive monthly_limit are required" });
    return;
  }

  const category = await db.prepare("SELECT 1 FROM categories WHERE id = ? AND user_id = ?").get(category_id, req.user!.id);
  if (!category) {
    res.status(404).json({ error: "category not found" });
    return;
  }

  await db
    .prepare(
      `INSERT INTO budgets (user_id, category_id, monthly_limit) VALUES (?, ?, ?)
       ON CONFLICT (user_id, category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`
    )
    .run(req.user!.id, category_id, monthly_limit);

  const created = await db.prepare("SELECT * FROM budgets WHERE user_id = ? AND category_id = ?").get(req.user!.id, category_id);
  res.status(201).json(created);
});

budgetsRouter.delete("/:id", async (req, res) => {
  const result = await db.prepare("DELETE FROM budgets WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "budget not found" });
    return;
  }
  res.status(204).send();
});

/**
 * What has been put into each category, month by month.
 *
 * Returned for every month at once rather than the one being looked at: the
 * balance carried into a month is the result of every month before it, so a
 * screen showing November needs October and September too. The whole set is
 * a few hundred rows for a few years of budgeting.
 */
budgetsRouter.get("/allocations", async (req, res) => {
  res.json(
    await db
      .prepare("SELECT category_id, month, amount FROM budget_allocations WHERE user_id = ? ORDER BY month")
      .all(req.user!.id)
  );
});

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Puts an amount into one category for one month.
 *
 * Upsert rather than insert: assigning twice is somebody changing their mind,
 * not a second envelope. Zero is a real answer — "nothing for this, this
 * month" — so it is stored rather than treated as a deletion.
 */
budgetsRouter.put("/allocations", async (req, res) => {
  const { category_id, month, amount } = req.body as { category_id?: unknown; month?: unknown; amount?: unknown };

  if (typeof category_id !== "number" || typeof month !== "string" || !MONTH.test(month)) {
    res.status(400).json({ error: "category_id and a month of YYYY-MM are required" });
    return;
  }
  // Negative would mean taking money out of an envelope and putting it
  // nowhere, which is not a thing this can express.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    res.status(400).json({ error: "amount must be a number that isn't negative" });
    return;
  }

  const owned = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?")
    .get<{ id: number }>(category_id, req.user!.id);
  if (!owned) {
    res.status(404).json({ error: "category not found" });
    return;
  }

  const saved = await db
    .prepare(
      `INSERT INTO budget_allocations (user_id, category_id, month, amount)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, category_id, month) DO UPDATE SET amount = EXCLUDED.amount
       RETURNING category_id, month, amount`
    )
    .get(req.user!.id, category_id, month, amount);

  res.json(saved);
});
