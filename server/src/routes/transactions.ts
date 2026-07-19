import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import type { Transaction } from "../types.js";

export const transactionsRouter = Router();

transactionsRouter.get("/", (req, res) => {
  const { accountId, from, to } = req.query;

  let query = "SELECT * FROM transactions WHERE 1=1";
  const params: string[] = [];

  if (accountId) {
    query += " AND account_id = ?";
    params.push(String(accountId));
  }
  if (from) {
    query += " AND booking_date >= ?";
    params.push(String(from));
  }
  if (to) {
    query += " AND booking_date <= ?";
    params.push(String(to));
  }
  query += " ORDER BY booking_date DESC";

  const rows = db.prepare(query).all(...params) as unknown as Transaction[];
  res.json(rows);
});

transactionsRouter.post("/", (req, res) => {
  const { account_id, booking_date, amount, currency, description, counterparty, category_id } = req.body;

  if (!account_id || !booking_date || typeof amount !== "number") {
    res.status(400).json({ error: "account_id, booking_date, and amount are required" });
    return;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO transactions (id, account_id, category_id, booking_date, amount, currency, description, counterparty, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
  ).run(id, account_id, category_id ?? null, booking_date, amount, currency ?? "USD", description ?? null, counterparty ?? null);

  const created = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  res.status(201).json(created);
});

transactionsRouter.patch("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id);

  if (!existing) {
    res.status(404).json({ error: "transaction not found" });
    return;
  }

  // Only touch fields the caller actually sent, so e.g. clearing category_id
  // to null (uncategorizing) is distinguishable from "leave it alone".
  const hasCategory = "category_id" in req.body;
  const hasDescription = "description" in req.body;

  db.prepare(
    `UPDATE transactions SET
       category_id = ${hasCategory ? "?" : "category_id"},
       description = ${hasDescription ? "?" : "description"}
     WHERE id = ?`
  ).run(...[hasCategory ? req.body.category_id : undefined, hasDescription ? req.body.description : undefined, req.params.id].filter((v) => v !== undefined));

  res.json(db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id));
});

transactionsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM transactions WHERE id = ? AND source = 'manual'").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "manual transaction not found" });
    return;
  }
  res.status(204).send();
});
