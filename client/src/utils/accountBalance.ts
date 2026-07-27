import type { Account, AccountType } from "../api/client.js";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "current", label: "Cheque account" },
  { value: "savings", label: "Savings account" },
  { value: "credit_card", label: "Credit card" },
  { value: "loan", label: "Personal loan" },
];

export function accountTypeLabel(account: Account): string {
  return ACCOUNT_TYPES.find((t) => t.value === (account.account_type ?? "current"))?.label ?? "Account";
}

/**
 * Whether the balance represents money owed rather than money held.
 *
 * The sign convention is unchanged either way — a debt is a negative balance,
 * which is what makes net worth come out right by simple addition. What this
 * changes is presentation: a card at -1,200 is shown and entered as 1,200
 * owed, because nobody thinks of their card balance as a negative number.
 */
export function isLiability(account: Account): boolean {
  return account.account_type === "credit_card" || account.account_type === "loan";
}

/**
 * A facility means different things by type, and means nothing on some.
 *
 * On a current account it's an arranged overdraft; on a card it's the credit
 * limit. A loan has neither — the principal is already the balance — and a
 * savings account has no facility at all.
 */
export function facilityLabel(account: Account): string | null {
  switch (account.account_type ?? "current") {
    case "credit_card":
      return "Credit limit";
    case "loan":
      return null;
    case "savings":
      return null;
    default:
      return "Overdraft";
  }
}

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
  // The bank's own available figure is the better base where there is one,
  // since it already accounts for holds and pending items the balance
  // doesn't. The sync stores it only when it differs from the balance, so
  // reaching for it here means it genuinely says something extra.
  const base = account.available_balance ?? accountBalance(account, txSum);
  return base + (account.overdraft_limit ?? 0);
}

/**
 * Whether "available" says anything on this account.
 *
 * On a loan it doesn't: the balance is what's owed, there is nothing to spend
 * against it, and printing "-15,000 available" underneath is worse than
 * printing nothing. A card with a limit has real headroom (limit less what's
 * owed), and everything else has at least its own balance.
 */
export function hasAvailable(account: Account): boolean {
  return (account.account_type ?? "current") !== "loan";
}

/**
 * How much an account is actually borrowing right now.
 *
 * A negative balance is money owed whatever the account is called — an
 * overdrawn cheque account is debt as surely as a loan is, which is why this
 * doesn't consult the type. A positive balance owes nothing, even where a
 * facility exists to draw on.
 */
export function amountDrawn(account: Account, txSum: number): number {
  return Math.max(0, -accountBalance(account, txSum));
}

/** Whether the account belongs in the borrowing picture at all. */
export function isBorrowing(account: Account, txSum: number): boolean {
  return accountBalance(account, txSum) < 0 || (account.overdraft_limit ?? 0) > 0;
}
