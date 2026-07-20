import type { Account } from "../api/client.js";

// Linked (enablebanking) accounts get their balance from the bank directly
// (captured via POST /bank-link/accounts/:id/sync) since Enable Banking
// only syncs a 90-day transaction window -- summing those transactions is
// never a real balance for an account with any history before that
// window. Manual accounts have no such source of truth, so they stay
// derived from the running sum of their own transactions.
export function accountBalance(account: Account, txSum: number): number {
  return account.source === "enablebanking" && account.balance != null ? account.balance : txSum;
}
