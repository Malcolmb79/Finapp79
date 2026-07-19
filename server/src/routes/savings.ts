import { Router } from "express";
import { db } from "../db/client.js";

export const savingsRouter = Router();

savingsRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM savings_goals ORDER BY created_at").all());
});

savingsRouter.post("/", (req, res) => {
  const { name, target_amount, target_date } = req.body;
  if (!name || typeof target_amount !== "number" || target_amount <= 0) {
    res.status(400).json({ error: "name and a positive target_amount are required" });
    return;
  }

  const result = db
    .prepare("INSERT INTO savings_goals (name, target_amount, target_date) VALUES (?, ?, ?)")
    .run(name, target_amount, target_date ?? null);

  res.status(201).json(db.prepare("SELECT * FROM savings_goals WHERE id = ?").get(result.lastInsertRowid));
});

// Add (or, with a negative amount, remove) a contribution — the common
// action for a goal — rather than requiring the caller to compute and
// resend the new current_amount themselves.
savingsRouter.post("/:id/contribute", (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== "number") {
    res.status(400).json({ error: "amount is required" });
    return;
  }

  const existing = db.prepare("SELECT * FROM savings_goals WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "savings goal not found" });
    return;
  }

  db.prepare("UPDATE savings_goals SET current_amount = MAX(0, current_amount + ?) WHERE id = ?").run(amount, req.params.id);
  res.json(db.prepare("SELECT * FROM savings_goals WHERE id = ?").get(req.params.id));
});

savingsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM savings_goals WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "savings goal not found" });
    return;
  }
  res.status(204).send();
});
