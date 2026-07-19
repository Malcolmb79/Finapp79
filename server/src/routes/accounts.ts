import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";

export const accountsRouter = Router();

accountsRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM accounts ORDER BY created_at").all());
});

accountsRouter.post("/", (req, res) => {
  const { name, currency } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const id = randomUUID();
  db.prepare("INSERT INTO accounts (id, name, currency, source) VALUES (?, ?, ?, 'manual')").run(id, name, currency ?? "USD");
  res.status(201).json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});
