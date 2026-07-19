import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

budgetsRouter.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         b.id,
         b.category_id,
         c.name AS category_name,
         b.monthly_limit,
         COALESCE(SUM(CASE WHEN t.amount < 0 AND t.booking_date >= ? THEN -t.amount ELSE 0 END), 0) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN transactions t ON t.category_id = b.category_id AND t.user_id = b.user_id
       WHERE b.user_id = ?
       GROUP BY b.id
       ORDER BY c.name`
    )
    .all(monthStart(), req.user!.id);

  res.json(rows);
});

// Upsert: one budget per (user, category), so setting a new limit for a
// category that already has one just updates it rather than erroring.
budgetsRouter.post("/", (req, res) => {
  const { category_id, monthly_limit } = req.body;
  if (!category_id || typeof monthly_limit !== "number" || monthly_limit <= 0) {
    res.status(400).json({ error: "category_id and a positive monthly_limit are required" });
    return;
  }

  const category = db.prepare("SELECT 1 FROM categories WHERE id = ? AND user_id = ?").get(category_id, req.user!.id);
  if (!category) {
    res.status(404).json({ error: "category not found" });
    return;
  }

  db.prepare(
    `INSERT INTO budgets (user_id, category_id, monthly_limit) VALUES (?, ?, ?)
     ON CONFLICT(user_id, category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ).run(req.user!.id, category_id, monthly_limit);

  const created = db.prepare("SELECT * FROM budgets WHERE user_id = ? AND category_id = ?").get(req.user!.id, category_id);
  res.status(201).json(created);
});

budgetsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM budgets WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "budget not found" });
    return;
  }
  res.status(204).send();
});
