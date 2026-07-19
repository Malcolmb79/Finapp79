import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

accountsRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at").all(req.user!.id));
});

accountsRouter.post("/", async (req, res) => {
  const { name, currency } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const id = randomUUID();
  await db.prepare("INSERT INTO accounts (id, user_id, name, currency, source) VALUES (?, ?, ?, ?, 'manual')").run(
    id,
    req.user!.id,
    name,
    currency ?? "USD"
  );
  res.status(201).json(await db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});
