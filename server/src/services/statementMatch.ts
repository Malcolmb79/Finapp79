import type { ParsedRow, StatementMapping } from "./statementParser.js";

/**
 * Checks a statement against the account it's about to be imported into.
 *
 * Two mistakes survive the confirmation dialog otherwise, because the parse
 * itself is perfectly correct in both: importing the right statement into the
 * wrong account, and importing a statement you've already imported (or one
 * whose rows fall outside the period it claims to cover). Neither shows up in
 * a row-by-row preview — they're only visible by comparing the document to
 * what it's being imported against.
 */

export interface StatementCheck {
  /** The account number printed on the statement, as shown to the user. */
  accountNumber: string | null;
  /**
   * Whether it matches the target account's stored number. Null when either
   * side has no number to compare — an unknown is not a mismatch, and must
   * not be reported as one.
   */
  accountMatches: boolean | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Rows dated outside the statement's own stated period. */
  outsidePeriod: number;
}

// Statements mask account numbers in inconsistent ways ("****1373", "62104109716",
// "IE29 AIBK 9311 5212 3456 78"), so comparison is on digits alone.
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * True when the two numbers plausibly identify the same account.
 *
 * A masked statement number shares only its tail with the stored one, so a
 * suffix comparison is the only workable test. Four digits is the shortest
 * suffix any bank masks to; below that the test would match unrelated
 * accounts and a false "wrong account" warning is worse than none.
 */
function sameAccount(statementNumber: string, accountNumber: string): boolean | null {
  const a = digits(statementNumber);
  const b = digits(accountNumber);
  if (a.length < 4 || b.length < 4) return null;
  const length = Math.min(a.length, b.length);
  return a.slice(-length) === b.slice(-length);
}

export interface ExistingTransaction {
  id: string;
  booking_date: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
}

export interface DuplicateMatch {
  id: string;
  date: string;
  amount: number;
  description: string | null;
}

/**
 * Pairs incoming rows against transactions already on the account.
 *
 * Matched on date and amount rather than the content hash the importer
 * dedupes with: a statement re-downloaded later often carries the same
 * payment with its description reworded or padded, which changes the hash but
 * is plainly the same transaction.
 *
 * Each existing transaction accounts for at most one incoming row. Without
 * that, a statement legitimately listing the same purchase twice would have
 * both occurrences flagged against a single stored transaction, and the user
 * would skip a payment they actually made.
 */
export function pairDuplicates(
  rows: { date: string; amount: number }[],
  existing: ExistingTransaction[]
): (DuplicateMatch | null)[] {
  const key = (date: string, amount: number) => `${date}|${amount.toFixed(2)}`;

  const byKey = new Map<string, ExistingTransaction[]>();
  for (const row of existing) {
    const k = key(row.booking_date, row.amount);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }

  const used = new Map<string, number>();
  return rows.map((row) => {
    const k = key(row.date, row.amount);
    const candidates = byKey.get(k) ?? [];
    const taken = used.get(k) ?? 0;
    if (taken >= candidates.length) return null;
    used.set(k, taken + 1);
    const match = candidates[taken];
    return {
      id: match.id,
      date: match.booking_date,
      amount: match.amount,
      description: match.description ?? match.counterparty,
    };
  });
}

export function checkStatement(
  mapping: StatementMapping,
  rows: ParsedRow[],
  account: { iban: string | null }
): StatementCheck {
  const accountNumber = mapping.accountNumber?.trim() || null;

  let accountMatches: boolean | null = null;
  if (accountNumber && account.iban) accountMatches = sameAccount(accountNumber, account.iban);

  // Fall back to the range the rows actually cover when the document doesn't
  // state a period — it still lets the dialog show what's about to land.
  const dates = rows.map((r) => r.date).sort();
  const periodStart = mapping.periodStart ?? dates[0] ?? null;
  const periodEnd = mapping.periodEnd ?? dates[dates.length - 1] ?? null;

  // Only meaningful against a period the document itself stated: comparing
  // rows to a range derived from those same rows can never find anything.
  const outsidePeriod =
    mapping.periodStart && mapping.periodEnd
      ? rows.filter((r) => r.date < mapping.periodStart! || r.date > mapping.periodEnd!).length
      : 0;

  return { accountNumber, accountMatches, periodStart, periodEnd, outsidePeriod };
}
