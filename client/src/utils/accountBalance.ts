import type { Account, AccountType } from "../api/client.js";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "current", label: "Cheque account" },
  { value: "savings", label: "Savings account" },
  { value: "credit_card", label: "Credit card" },
  { value: "loan", label: "Personal loan" },
];

/**
 * Accounts that count towards a total.
 *
 * Two separate reasons an account drops out:
 *
 * `hidden` is a standing statement that it shouldn't count towards anything —
 * a closed account, one somebody else tracks, one being wound down. Hiding
 * rather than deleting keeps its history, which deletion wouldn't.
 *
 * `scope` is a temporary lens: look at just this account for a moment. It says
 * nothing about the account and changes several times a minute.
 *
 * The Accounts page deliberately applies neither: it is the only place a
 * hidden account stays visible, and hiding it there too would make the state
 * impossible to undo.
 */
export function visibleAccounts(accounts: Account[], scope?: string | null): Account[] {
  // Scope wins over hidden, and deliberately: asking to look at one account is
  // explicit, so honouring it beats showing a page of zeroes because the
  // account also happens to be hidden. It matches what the transactions do
  // below, which is what keeps the two from disagreeing.
  if (scope) return accounts.filter((account) => account.id === scope);
  return accounts.filter((account) => !account.hidden);
}

/**
 * Transactions belonging to accounts that count.
 *
 * A dropped account's transactions have to go with it. Leaving them in means
 * net worth excludes the account while spending by category still counts its
 * spending — two views disagreeing about which accounts exist.
 *
 * Note this reads `accounts` for the hidden flags but matches `scope` against
 * the id directly, so it stays correct while the accounts are still loading —
 * a moment when an id-based include list would filter everything away and
 * flash a page of zeroes.
 */
export function visibleTransactions<T extends { account_id: string }>(
  transactions: T[],
  accounts: Account[],
  scope?: string | null
): T[] {
  if (scope) return transactions.filter((tx) => tx.account_id === scope);
  const hidden = new Set(accounts.filter((account) => account.hidden).map((account) => account.id));
  return hidden.size === 0 ? transactions : transactions.filter((tx) => !hidden.has(tx.account_id));
}

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
  // A balance set by hand is where the account stood when it was entered, not
  // where it stands forever. Treated as final it froze the account: a figure
  // corrected once never moved again however many transactions arrived, and
  // the account read as broken rather than as overridden.
  //
  // So it is an opening figure, and `txSum` carries only what has been booked
  // since — see accountTxSums, which is what every caller should build its
  // sums with.
  if (account.balance_is_manual && account.balance != null) return account.balance + txSum;
  return account.source === "enablebanking" && account.balance != null ? account.balance : txSum;
}

/**
 * Each account's transaction sum, counted from the point its balance was set.
 *
 * An account with a hand-set balance only wants what has happened since —
 * everything before it is already inside the figure that was entered, and
 * adding the lot would count months of history twice. An account without one
 * wants the whole history, since that is all it has.
 *
 * A linked account takes the bank's figure and ignores this entirely: the
 * bank has already counted its own transactions, and a sync happens often
 * enough that adding today's on top would double them.
 */
export function accountTxSums(
  accounts: Account[],
  transactions: { account_id: string; booking_date: string; amount: number }[]
): Map<string, number> {
  const anchors = new Map<string, string | null>();
  for (const account of accounts) {
    // The date the balance was entered, which is also when a sync last wrote
    // one. Only meaningful for a manual figure; the rest count everything.
    anchors.set(account.id, account.balance_is_manual ? (account.balance_synced_at?.slice(0, 10) ?? null) : null);
  }

  const sums = new Map<string, number>();
  for (const tx of transactions) {
    const anchor = anchors.get(tx.account_id);
    // Strictly after: a transaction booked on the day the balance was entered
    // is assumed to be in it, which is the safer of the two mistakes — it
    // understates a change rather than inventing one.
    if (anchor && tx.booking_date <= anchor) continue;
    sums.set(tx.account_id, (sums.get(tx.account_id) ?? 0) + tx.amount);
  }
  return sums;
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

/**
 * Whether the account belongs in the borrowing picture at all.
 *
 * A card or a loan qualifies on what it is, not on what it currently reads.
 * Requiring a negative balance made any liability with no balance recorded
 * disappear from the Debt Planner entirely — no row, no chart, no explanation
 * — which is indistinguishable from the app having lost it. Showing it with
 * nothing owed is honest and points at the missing figure; hiding it is not.
 */
export function isBorrowing(account: Account, txSum: number): boolean {
  return isLiability(account) || accountBalance(account, txSum) < 0 || (account.overdraft_limit ?? 0) > 0;
}
