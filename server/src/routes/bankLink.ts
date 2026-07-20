import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as enableBanking from "../services/enableBanking.js";
import type { RemoteTransaction } from "../services/enableBanking.js";

export const bankLinkRouter = Router();

bankLinkRouter.use(requireAuth);

bankLinkRouter.get("/institutions", async (req, res) => {
  const country = (req.query.country as string) ?? "GB";
  const aspsps = await enableBanking.listAspsps(country);
  res.json(aspsps);
});

// Step 1: start a bank link. Returns the URL to redirect the user to.
// We generate our own `state` up front so we have somewhere to record the
// pending connection before the user ever leaves our site.
bankLinkRouter.post("/authorize", async (req, res) => {
  const { aspsp_name, country, logo } = req.body;
  if (!aspsp_name || !country) {
    res.status(400).json({ error: "aspsp_name and country are required" });
    return;
  }

  const state = randomUUID();
  await db
    .prepare(
      `INSERT INTO bank_connections (id, user_id, institution_id, institution_name, logo, country, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(state, req.user!.id, aspsp_name, aspsp_name, logo ?? null, country);

  const authorization = await enableBanking.startAuthorization(
    { name: aspsp_name, country },
    state,
    process.env.ENABLE_BANKING_REDIRECT_URL ?? ""
  );

  res.json({ state, authorizationUrl: authorization.url });
});

// Step 2: after the user authorizes at their bank, Enable Banking redirects
// back with ?code=&state=. Exchange the code for a session and store the
// linked accounts.
bankLinkRouter.post("/sessions", async (req, res) => {
  const { code, state } = req.body;
  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const connection = await db.prepare("SELECT * FROM bank_connections WHERE id = ? AND user_id = ?").get(state, req.user!.id);
  if (!connection) {
    res.status(404).json({ error: "no pending bank connection for this state" });
    return;
  }

  const session = await enableBanking.exchangeCode(code);

  await db.prepare("UPDATE bank_connections SET status = 'linked' WHERE id = ?").run(state);

  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, user_id, bank_connection_id, name, iban, currency, source)
     VALUES (?, ?, ?, ?, ?, ?, 'enablebanking')
     ON CONFLICT (id) DO NOTHING`
  );

  for (const account of session.accounts) {
    await insertAccount.run(
      account.uid,
      req.user!.id,
      state,
      account.name ?? "Linked account",
      account.account_id?.iban ?? null,
      account.currency
    );
  }

  res.json({ linkedAccounts: session.accounts.map((a) => a.uid) });
});

function signedAmount(tx: RemoteTransaction): number {
  const magnitude = Math.abs(Number(tx.transaction_amount.amount));
  return tx.credit_debit_indicator === "DBIT" ? -magnitude : magnitude;
}

// Some banks (via Enable Banking's remittance_information) include a
// structured metadata blob in curly braces alongside the real payee name
// — e.g. a Barclays entry might come as two array elements, "ANTHROPIC"
// and "{ TransactionSubType : Purchase, PaymentInitiationDateTime : ... }".
// Drop any element that's just that blob, then strip inline brace content
// too in case a bank concatenates it onto the same element instead.
function cleanRemittanceInfo(parts: string[] | undefined): string | null {
  const cleaned = (parts ?? [])
    .filter((p) => !p.trim().startsWith("{"))
    .join(" ")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

function transactionId(accountUid: string, tx: RemoteTransaction): string {
  if (tx.transaction_id) return tx.transaction_id;
  if (tx.entry_reference) return `${accountUid}:${tx.entry_reference}`;
  const hashInput = `${accountUid}:${tx.booking_date}:${tx.transaction_amount.amount}:${(tx.remittance_information ?? []).join(" ")}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

// Berlin Group/XS2A balance_type values, in preference order — different
// banks populate different subsets, so this tries the most specific first
// and falls back rather than requiring an exact match.
const BOOKED_BALANCE_TYPES = ["closingBooked", "interimBooked", "openingBooked", "expected"];
const AVAILABLE_BALANCE_TYPES = ["interimAvailable", "closingAvailable", "forwardAvailable", "expected"];

function pickBalance(balances: enableBanking.AccountBalance[], types: string[]): number | null {
  for (const type of types) {
    const match = balances.find((b) => b.balance_type === type);
    if (match) return Number(match.balance_amount.amount);
  }
  return null;
}

// Step 3: pull transactions for a linked account and upsert them.
bankLinkRouter.post("/accounts/:accountId/sync", async (req, res) => {
  const { accountId } = req.params;

  const account = await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND user_id = ?").get(accountId, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const transactions = await enableBanking.listAccountTransactions(accountId);

  let synced = 0;
  await withTransaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, counterparty, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enablebanking')
       ON CONFLICT (id) DO NOTHING`
    );
    for (const t of transactions) {
      const result = await insert.run(
        transactionId(accountId, t),
        req.user!.id,
        accountId,
        t.booking_date,
        signedAmount(t),
        t.transaction_amount.currency,
        cleanRemittanceInfo(t.remittance_information),
        t.creditor?.name ?? t.debtor?.name ?? null
      );
      if (result.changes > 0) synced++;
    }
  });

  // Best-effort: a bank not supporting balance retrieval shouldn't fail the
  // whole sync, since the transactions above already succeeded.
  try {
    const balances = await enableBanking.getAccountBalances(accountId);
    console.log(`Balances for account ${accountId}:`, JSON.stringify(balances)); // TEMP: remove after confirming real balance_type values
    const booked = pickBalance(balances, BOOKED_BALANCE_TYPES);
    const available = pickBalance(balances, AVAILABLE_BALANCE_TYPES);
    if (booked !== null || available !== null) {
      await db
        .prepare("UPDATE accounts SET balance = ?, available_balance = ?, balance_synced_at = ? WHERE id = ?")
        .run(booked, available, new Date().toISOString(), accountId);
    }
  } catch (err) {
    console.error(`Failed to sync balance for account ${accountId}:`, err);
  }

  res.json({ synced, totalFetched: transactions.length });
});
