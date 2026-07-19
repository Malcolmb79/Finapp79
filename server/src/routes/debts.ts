import { Router } from "express";
import { db } from "../db/client.js";

export const debtsRouter = Router();

debtsRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM debts ORDER BY apr DESC").all());
});

debtsRouter.post("/", (req, res) => {
  const { name, balance, apr, minimum_payment } = req.body;
  if (!name || typeof balance !== "number" || typeof minimum_payment !== "number") {
    res.status(400).json({ error: "name, balance, and minimum_payment are required" });
    return;
  }

  const result = db
    .prepare("INSERT INTO debts (name, balance, apr, minimum_payment) VALUES (?, ?, ?, ?)")
    .run(name, balance, apr ?? 0, minimum_payment);

  res.status(201).json(db.prepare("SELECT * FROM debts WHERE id = ?").get(result.lastInsertRowid));
});

// Only fields present in the body are touched, so e.g. recording a payment
// (balance only) doesn't require resending apr/minimum_payment.
debtsRouter.patch("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM debts WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "debt not found" });
    return;
  }

  const fields = ["name", "balance", "apr", "minimum_payment"] as const;
  const updates = fields.filter((f) => f in req.body);
  if (updates.length === 0) {
    res.json(existing);
    return;
  }

  db.prepare(`UPDATE debts SET ${updates.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`).run(
    ...updates.map((f) => req.body[f]),
    req.params.id
  );

  res.json(db.prepare("SELECT * FROM debts WHERE id = ?").get(req.params.id));
});

debtsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM debts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "debt not found" });
    return;
  }
  res.status(204).send();
});
