/**
 * Attributing a transaction to the loan it repays.
 *
 * A personal loan is paid by direct debit from whichever account funds it, and
 * nothing lands on the loan itself. One payment therefore has to be two facts
 * at once: money left the current account, and what is owed on the loan went
 * down by the same amount. Without the second, a loan balance is whatever was
 * last typed in and drifts further from the truth every month.
 *
 * The attribution is derived on every read rather than written onto the
 * transaction. A rule is a statement about what these payments mean, so
 * editing or removing one has to change what the figures say — a stored
 * `repays_account_id` would outlive the rule that justified it, which is the
 * kind of wrong figure nobody goes looking for.
 *
 * Deciding this on the server rather than in the client matters for the same
 * reason: `GET /api/plan` works out a monthly surplus from the same
 * transactions the dashboard draws, and two implementations of "is this a
 * repayment" would disagree eventually.
 */

export interface TransactionRule {
  id: string;
  match_text: string;
  /** Null means any account, though the UI always names one. */
  match_account_id: string | null;
  repays_account_id: string;
}

/** The fields matching needs — any transaction-shaped row will do. */
interface Matchable {
  account_id: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
}

/**
 * The loan a transaction repays, or null.
 *
 * Three conditions, each one earning its place:
 *
 * Only an outflow counts. A refund from the lender, or interest credited back,
 * carries the same words and would otherwise *increase* what is owed.
 *
 * A transaction already sitting on the loan account is never a repayment of
 * it. Attributing one would count it twice — once where it is, once mirrored
 * onto the same account.
 *
 * The first matching rule wins, so a narrower rule can be written above a
 * broader one without the two fighting over the same payment.
 */
export function repaidAccountId(tx: Matchable, rules: TransactionRule[]): string | null {
  if (tx.amount >= 0) return null;

  const haystack = `${tx.description ?? ""} ${tx.counterparty ?? ""}`.toLowerCase();

  for (const rule of rules) {
    if (rule.repays_account_id === tx.account_id) continue;
    if (rule.match_account_id && rule.match_account_id !== tx.account_id) continue;
    const needle = rule.match_text.trim().toLowerCase();
    // An empty match would attribute every outflow on the account, which is
    // never what anyone meant to write.
    if (!needle) continue;
    if (haystack.includes(needle)) return rule.repays_account_id;
  }

  return null;
}

/** Each transaction with the loan it repays attached, for the client to use. */
export function annotateRepayments<T extends Matchable>(
  transactions: T[],
  rules: TransactionRule[]
): (T & { repays_account_id: string | null })[] {
  // Nothing to say when there are no rules, which is every account until
  // someone writes one.
  if (rules.length === 0) return transactions.map((tx) => ({ ...tx, repays_account_id: null }));
  return transactions.map((tx) => ({ ...tx, repays_account_id: repaidAccountId(tx, rules) }));
}
