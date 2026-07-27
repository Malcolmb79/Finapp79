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

// Kept in one place because both the create and the update path validate
// against it, and an unrecognised type would quietly change how a balance is
// read — see schema.sql.
export const ACCOUNT_TYPES = ["current", "savings", "credit_card", "loan"];

accountsRouter.post("/", async (req, res) => {
  const { name, currency, account_type } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (account_type !== undefined && !ACCOUNT_TYPES.includes(account_type)) {
    res.status(400).json({ error: "unknown account type" });
    return;
  }

  const id = randomUUID();
  await db.prepare("INSERT INTO accounts (id, user_id, name, currency, source, account_type) VALUES (?, ?, ?, ?, 'manual', ?)").run(
    id,
    req.user!.id,
    name,
    currency ?? "USD",
    account_type ?? "current"
  );
  res.status(201).json(await db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

// Renaming works for every account regardless of source (manual or
// enablebanking-linked) — a display name isn't something that needs to
// stay in sync with the bank, so unlike transactions.source (where only
// 'manual' rows are deletable), there's no reason to restrict this.
accountsRouter.patch("/:id", async (req, res) => {
  const { name, balance, overdraft_limit, account_type } = req.body as {
    name?: unknown;
    balance?: unknown;
    overdraft_limit?: unknown;
    account_type?: unknown;
  };

  const sets: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name must not be empty" });
      return;
    }
    sets.push("name = ?");
    params.push(name.trim());
  }

  // A balance entered by hand becomes the account's balance outright, the
  // same field a sync writes, so everything downstream reads one number
  // rather than choosing between two. It's flagged as manual so a later sync
  // is distinguishable, and null clears it — handing a derived account back
  // to its transaction history.
  if (balance !== undefined) {
    if (balance !== null && (typeof balance !== "number" || !Number.isFinite(balance))) {
      res.status(400).json({ error: "balance must be a number or null" });
      return;
    }
    sets.push("balance = ?", "balance_is_manual = ?", "balance_synced_at = ?");
    params.push(balance, balance !== null, balance === null ? null : new Date().toISOString());
  }

  // Stored as a positive figure: an overdraft of 45,000 means the balance may
  // run to -45,000. Null removes the facility.
  if (overdraft_limit !== undefined) {
    if (
      overdraft_limit !== null &&
      (typeof overdraft_limit !== "number" || !Number.isFinite(overdraft_limit) || overdraft_limit < 0)
    ) {
      res.status(400).json({ error: "overdraft_limit must be a positive number or null" });
      return;
    }
    sets.push("overdraft_limit = ?");
    params.push(overdraft_limit);
  }

  if (account_type !== undefined) {
    if (typeof account_type !== "string" || !ACCOUNT_TYPES.includes(account_type)) {
      res.status(400).json({ error: "unknown account type" });
      return;
    }
    sets.push("account_type = ?");
    params.push(account_type);
  }

  if (sets.length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }

  const result = await db
    .prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...params, req.params.id, req.user!.id);
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
