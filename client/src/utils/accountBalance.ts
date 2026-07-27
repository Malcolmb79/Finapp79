import type { Account } from "../api/client.js";

// Linked (enablebanking) accounts get their balance from the bank directly
// (captured via POST /bank-link/accounts/:id/sync) since Enable Banking
// only syncs a 90-day transaction window -- summing those transactions is
// never a real balance for an account with any history before that
// window. Manual accounts have no such source of truth, so they stay
// derived from the running sum of their own transactions.
export function accountBalance(account: Account, txSum: number): number {
  // A balance set by hand is a deliberate statement about what the account
  // holds, so it outranks a derived sum for any account — that's the whole
  // point of entering it. Clearing it hands the account back to its
  // transaction history.
  if (account.balance_is_manual && account.balance != null) return account.balance;
  return account.source === "enablebanking" && account.balance != null ? account.balance : txSum;
}

/**
 * What can actually be spent: the balance plus any arranged overdraft.
 *
 * Kept separate from accountBalance because an overdraft is borrowing, not
 * money held — it belongs here and never in net worth.
 */
export function accountAvailable(account: Account, txSum: number): number {
  return accountBalance(account, txSum) + (account.overdraft_limit ?? 0);
}
