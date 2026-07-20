import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

accountsRouter.get("/", async (req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT a.*, bc.institution_name, bc.logo
         FROM accounts a
         LEFT JOIN bank_connections bc ON bc.id = a.bank_connection_id
         WHERE a.user_id = ?
         ORDER BY a.created_at`
      )
      .all(req.user!.id)
  );
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

// Renaming works for every account regardless of source (manual or
// enablebanking-linked) — unlike deleting a transaction, a display name
// isn't something that needs to stay in sync with the bank, so there's no
// reason to restrict this to manual accounts the way DELETE is elsewhere.
accountsRouter.patch("/:id", async (req, res) => {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const result = await db
    .prepare("UPDATE accounts SET name = ? WHERE id = ? AND user_id = ?")
    .run(name.trim(), req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  res.json(await db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.params.id));
});
