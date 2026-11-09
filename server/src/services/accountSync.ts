import { db, withTransaction } from "../db/client.js";
import * as enableBanking from "./enableBanking.js";
import type { RemoteTransaction } from "./enableBanking.js";

/**
 * Pulling one linked account up to date.
 *
 * Lifted out of the sync route unchanged so a schedule can call exactly what
 * the button calls. Two implementations of "sync an account" would drift, and
 * the one that drifts is always the one nobody is watching — which, once this
 * runs nightly, is this one.
 */

/** Signs Enable Banking's unsigned amount into this app's convention. */
export function signedAmount(tx: RemoteTransaction): number {
  // The magnitude, not the raw number. Enable Banking reports amounts
  // unsigned with a separate credit/debit indicator, but a bank sending a
  // sign anyway would otherwise flip a debit back into an inflow.
  const magnitude = Math.abs(Number(tx.transaction_amount.amount));
  return tx.credit_debit_indicator === "DBIT" ? -magnitude : magnitude;
}


export interface SyncResult {
  synced: number;
  totalFetched: number;
}

const BOOKED_BALANCE_TYPES = ["CLBD", "XPCD", "ITBD", "PRCD", "OTHR"];
const AVAILABLE_BALANCE_TYPES = ["CLAV", "XPCD", "ITAV", "OTHR"];

function pickBalance(balances: { balance_type?: string; balance_amount?: { amount?: string } }[], types: string[]): number | null {
  for (const type of types) {
    const found = balances.find((b) => b.balance_type === type);
    const amount = found?.balance_amount?.amount;
    if (amount != null && Number.isFinite(Number(amount))) return Number(amount);
  }
  return null;
}

export async function syncAccount(
  accountId: string,
  userId: string,
  helpers: {
    transactionId: (accountId: string, t: RemoteTransaction) => string;
    cleanRemittanceInfo: (info: RemoteTransaction["remittance_information"]) => string | null;
  }
): Promise<SyncResult> {
  const transactions = (await enableBanking.listAccountTransactions(accountId)) as unknown as RemoteTransaction[];

  let synced = 0;
  await withTransaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, counterparty, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enablebanking')
       ON CONFLICT (id) DO NOTHING`
    );
    for (const t of transactions) {
      const result = await insert.run(
        helpers.transactionId(accountId, t),
        userId,
        accountId,
        t.booking_date,
        signedAmount(t),
        t.transaction_amount.currency,
        helpers.cleanRemittanceInfo(t.remittance_information),
        t.creditor?.name ?? t.debtor?.name ?? null
      );
      if (result.changes > 0) synced++;
    }
  });

  // Best-effort: a bank not supporting balance retrieval shouldn't fail the
  // whole sync, since the transactions above already succeeded.
  try {
    const balances = await enableBanking.getAccountBalances(accountId);
    const booked = pickBalance(balances, BOOKED_BALANCE_TYPES);
    const reported = pickBalance(balances, AVAILABLE_BALANCE_TYPES);
    // When a bank sends only one usable figure it lands in both lists, and
    // storing it twice renders as "€3,099.26 available" under a balance of
    // €3,099.26 — noise dressed up as information.
    const available = reported !== null && reported !== booked ? reported : null;
    if (booked !== null || available !== null) {
      await db
        .prepare(
          `UPDATE accounts
              SET balance = ?,
                  synced_balance = ?,
                  available_balance = ?,
                  balance_synced_at = ?,
                  balance_is_manual = FALSE
            WHERE id = ?`
        )
        .run(booked, booked, available, new Date().toISOString(), accountId);
    }
  } catch (err) {
    console.error(`Failed to sync balance for account ${accountId}:`, err);
  }

  // The overdraft is on the account details resource, not the balances one.
  // Only filled in where it hasn't been set by hand.
  try {
    const details = await enableBanking.getAccountDetails(accountId);
    const limit = details.credit_limit ? Number(details.credit_limit.amount) : null;
    if (limit !== null && Number.isFinite(limit)) {
      await db.prepare("UPDATE accounts SET overdraft_limit = ? WHERE id = ? AND overdraft_limit IS NULL").run(Math.abs(limit), accountId);
    }
  } catch (err) {
    console.error(`Failed to sync overdraft limit for account ${accountId}:`, err);
  }

  return { synced, totalFetched: transactions.length };
}

/**
 * Every linked account, across every user.
 *
 * The schedule runs with no session, so it cannot ask "whose accounts?" the
 * way a request can — it has to walk them all. The user id comes off each row
 * and is carried into the insert, so the per-user scoping every other query
 * relies on holds here too.
 */
export async function linkedAccounts(): Promise<{ id: string; user_id: string; name: string }[]> {
  return (await db
    .prepare("SELECT id, user_id, name FROM accounts WHERE source = 'enablebanking' AND hidden = FALSE ORDER BY user_id, name")
    .all()) as unknown as { id: string; user_id: string; name: string }[];
}

/**
 * Records what happened, win or lose.
 *
 * A schedule nobody watches is only trustworthy if its failures are visible
 * where the account is. An expired bank authorisation is the common one — they
 * lapse after about 90 days — and without this the account simply stops
 * updating, which looks exactly like an account with nothing happening on it.
 */
export async function recordSyncAttempt(accountId: string, error: string | null): Promise<void> {
  await db
    .prepare("UPDATE accounts SET last_sync_at = ?, last_sync_error = ? WHERE id = ?")
    .run(new Date().toISOString(), error, accountId);
}
