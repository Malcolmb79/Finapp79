import { Router } from "express";
import { db } from "../db/client.js";

export const budgetsRouter = Router();

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

budgetsRouter.get("/", (_req, res) => {
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
       LEFT JOIN transactions t ON t.category_id = b.category_id
       GROUP BY b.id
       ORDER BY c.name`
    )
    .all(monthStart());

  res.json(rows);
});

// Upsert: one budget per category, so setting a new limit for a category
// that already has one just updates it rather than erroring.
budgetsRouter.post("/", (req, res) => {
  const { category_id, monthly_limit } = req.body;
  if (!category_id || typeof monthly_limit !== "number" || monthly_limit <= 0) {
    res.status(400).json({ error: "category_id and a positive monthly_limit are required" });
    return;
  }

  db.prepare(
    `INSERT INTO budgets (category_id, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ).run(category_id, monthly_limit);

  const created = db.prepare("SELECT * FROM budgets WHERE category_id = ?").get(category_id);
  res.status(201).json(created);
});

budgetsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM budgets WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "budget not found" });
    return;
  }
  res.status(204).send();
});
