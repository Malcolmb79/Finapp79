import type { Account } from "../api/client.js";

// Linked (plaid) accounts get their balance from the bank directly
// (captured via POST /bank-link/accounts/:id/sync) rather than summing
// their own transactions, since a sync only ever reflects transactions
// since the last cursor, not full account history. Manual accounts have no
// such source of truth, so they stay derived from the running sum of their
// own transactions.
export function accountBalance(account: Account, txSum: number): number {
  return account.source === "plaid" && account.balance != null ? account.balance : txSum;
}
