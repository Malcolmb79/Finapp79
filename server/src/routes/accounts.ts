import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
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
// enablebanking-linked) — a display name isn't something that needs to
// stay in sync with the bank, so unlike transactions.source (where only
// 'manual' rows are deletable), there's no reason to restrict this.
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

/**
 * Clears an account's transactions without removing the account.
 *
 * Deleting the account was previously the only way to shed its transactions,
 * which is too blunt when the account itself is fine and only an import went
 * wrong. `source` scopes it: clearing just the imported rows leaves
 * bank-synced and manually entered history intact, which is what you want
 * after a statement is imported with the wrong sign or against the wrong
 * account.
 */
accountsRouter.delete("/:id/transactions", async (req, res) => {
  const account = await db
    .prepare("SELECT 1 FROM accounts WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const source = typeof req.query.source === "string" ? req.query.source : null;
  if (source !== null && !["csv", "enablebanking", "manual"].includes(source)) {
    res.status(400).json({ error: "unknown source" });
    return;
  }

  const result = source
    ? await db
        .prepare("DELETE FROM transactions WHERE account_id = ? AND user_id = ? AND source = ?")
        .run(req.params.id, req.user!.id, source)
    : await db.prepare("DELETE FROM transactions WHERE account_id = ? AND user_id = ?").run(req.params.id, req.user!.id);

  res.json({ deleted: result.changes });
});

// Removing an account also removes its own transaction history (there's no
// other reasonable state for an orphaned transaction to be in) and, if this
// was the last account on its bank_connection, the bank_connection row too
// — but only then, since a connection covering multiple accounts (e.g.
// checking + savings from the same bank) must survive removing just one.
accountsRouter.delete("/:id", async (req, res) => {
  const account = await db
    .prepare("SELECT bank_connection_id FROM accounts WHERE id = ? AND user_id = ?")
    .get<{ bank_connection_id: string | null }>(req.params.id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  await withTransaction(async (tx) => {
    await tx.prepare("DELETE FROM transactions WHERE account_id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    await tx.prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    if (account.bank_connection_id) {
      const remaining = await tx.prepare("SELECT 1 FROM accounts WHERE bank_connection_id = ?").get(account.bank_connection_id);
      if (!remaining) {
        await tx.prepare("DELETE FROM bank_connections WHERE id = ? AND user_id = ?").run(account.bank_connection_id, req.user!.id);
      }
    }
  });

  res.status(204).send();
});
