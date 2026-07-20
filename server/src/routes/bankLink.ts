import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as plaid from "../services/plaid.js";

export const bankLinkRouter = Router();

bankLinkRouter.use(requireAuth);

// Step 1: create a Link token. The client hands this straight to Plaid's
// own hosted widget (react-plaid-link) — unlike Enable Banking, there's no
// country/bank picker of our own to drive here, Plaid Link does its own
// institution search internally.
bankLinkRouter.post("/link-token", async (req, res) => {
  const linkToken = await plaid.createLinkToken(req.user!.id, process.env.PLAID_REDIRECT_URI || undefined);
  res.json({ linkToken });
});

// Step 2: after the widget's onSuccess fires client-side with a
// public_token (+ which institution the user picked), exchange it for a
// long-lived access_token and create the bank_connection + accounts rows.
bankLinkRouter.post("/exchange", async (req, res) => {
  const { public_token, institution_id } = req.body;
  if (!public_token || !institution_id) {
    res.status(400).json({ error: "public_token and institution_id are required" });
    return;
  }

  const { accessToken, itemId } = await plaid.exchangePublicToken(public_token);
  const institution = await plaid.getInstitution(institution_id);
  const balances = await plaid.getAccountBalances(accessToken);

  const connectionId = randomUUID();
  await db
    .prepare(
      `INSERT INTO bank_connections (id, user_id, institution_id, institution_name, logo, country, status, access_token, item_id)
       VALUES (?, ?, ?, ?, ?, ?, 'linked', ?, ?)`
    )
    .run(connectionId, req.user!.id, institution_id, institution.name, institution.logo, institution.country, accessToken, itemId);

  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, user_id, bank_connection_id, name, currency, source, balance, available_balance, balance_synced_at)
     VALUES (?, ?, ?, ?, ?, 'plaid', ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`
  );
  const now = new Date().toISOString();
  for (const b of balances) {
    await insertAccount.run(b.accountId, req.user!.id, connectionId, b.name, b.currency ?? "USD", b.current, b.available, now);
  }

  res.json({ linkedAccounts: balances.map((b) => b.accountId) });
});

// Step 3: pull transactions for a linked account and upsert them. Plaid's
// cursor-based /transactions/sync covers every account on the same Item in
// one call (not just the account_id in the URL), so syncing any one
// account naturally keeps its siblings (e.g. checking + savings from the
// same bank) up to date too.
bankLinkRouter.post("/accounts/:accountId/sync", async (req, res) => {
  const { accountId } = req.params;

  const account = await db
    .prepare("SELECT bank_connection_id FROM accounts WHERE id = ? AND user_id = ?")
    .get<{ bank_connection_id: string | null }>(accountId, req.user!.id);
  if (!account || !account.bank_connection_id) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const connection = await db
    .prepare("SELECT access_token, sync_cursor FROM bank_connections WHERE id = ? AND user_id = ?")
    .get<{ access_token: string; sync_cursor: string | null }>(account.bank_connection_id, req.user!.id);
  if (!connection) {
    res.status(404).json({ error: "bank connection not found" });
    return;
  }

  const { added, modified, removed, nextCursor } = await plaid.syncTransactions(connection.access_token, connection.sync_cursor);

  let synced = 0;
  await withTransaction(async (tx) => {
    // Plaid's sync model explicitly distinguishes "modified" from "added"
    // (e.g. a pending transaction's amount finalizing) — unlike the
    // add-only sources elsewhere in this app, upsert on conflict instead of
    // leaving stale data in place.
    const insert = tx.prepare(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, counterparty, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plaid')
       ON CONFLICT (id) DO UPDATE SET
         booking_date = excluded.booking_date,
         amount = excluded.amount,
         currency = excluded.currency,
         description = excluded.description,
         counterparty = excluded.counterparty`
    );
    for (const t of [...added, ...modified]) {
      // Plaid's amount is positive for money leaving the account, negative
      // for money coming in — opposite of this app's negative-is-outflow
      // convention, so negate on the way in.
      const result = await insert.run(
        t.transaction_id,
        req.user!.id,
        t.account_id,
        t.date,
        -t.amount,
        t.iso_currency_code ?? "USD",
        t.merchant_name ?? t.name,
        t.merchant_name ?? null
      );
      if (result.changes > 0) synced++;
    }
    for (const id of removed) {
      await tx.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, req.user!.id);
    }
  });

  await db.prepare("UPDATE bank_connections SET sync_cursor = ? WHERE id = ?").run(nextCursor, account.bank_connection_id);

  // Best-effort: a balance refresh failure shouldn't fail the whole sync,
  // since the transactions above already succeeded.
  try {
    const balances = await plaid.getAccountBalances(connection.access_token);
    const now = new Date().toISOString();
    for (const b of balances) {
      await db
        .prepare("UPDATE accounts SET balance = ?, available_balance = ?, balance_synced_at = ? WHERE id = ? AND user_id = ?")
        .run(b.current, b.available, now, b.accountId, req.user!.id);
    }
  } catch (err) {
    console.error(`Failed to sync balances for connection ${account.bank_connection_id}:`, err);
  }

  res.json({ synced, totalFetched: added.length + modified.length });
});
