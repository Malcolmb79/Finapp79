import type { Transaction } from "../api/client.js";

/**
 * Transactions that look like the same payment stored twice.
 *
 * The app guards the two doors separately and neither sees the other. A
 * statement import checks its rows against what is stored; a bank sync
 * dedupes on the bank's own reference. So the same payment arriving by both
 * routes passes both checks, and a bank that reports a payment once as
 * pending and again as booked issues two references for one payment and
 * passes its own.
 *
 * Nothing looked at what was already there. This does, and it is deliberately
 * only a question: a date, an amount and an account matching is strong
 * evidence and is not proof. Two £3.35 coffees on one day in one shop is an
 * ordinary Tuesday, and deleting one because it looked like a duplicate would
 * be the app quietly losing a transaction that happened.
 */

export interface DuplicateGroup {
  /** The one that arrived first, kept as the original. */
  original: Transaction;
  /** The later arrivals, offered for removal. */
  copies: Transaction[];
}

/** Same account, same day, same amount to the penny. */
function fingerprint(tx: Transaction): string {
  return `${tx.account_id}|${tx.booking_date}|${tx.amount.toFixed(2)}`;
}

/**
 * Which of two identical-looking rows is the original.
 *
 * The earliest `created_at` — the one that was there first is the one other
 * things may already reference, and the later arrival is the one that was
 * added by the second route. Falls back to id so the answer is stable rather
 * than depending on the order rows came back in.
 */
function arrivedFirst(a: Transaction, b: Transaction): number {
  const byCreated = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
}

export function findDuplicates(transactions: Transaction[]): DuplicateGroup[] {
  const byFingerprint = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    // A zero-amount row carries no evidence: every one of them would match
    // every other on the same day.
    if (tx.amount === 0) continue;
    const key = fingerprint(tx);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), tx]);
  }

  const groups: DuplicateGroup[] = [];
  for (const matches of byFingerprint.values()) {
    if (matches.length < 2) continue;
    const ordered = [...matches].sort(arrivedFirst);
    groups.push({ original: ordered[0], copies: ordered.slice(1) });
  }

  // Largest first: a duplicated salary matters more than a duplicated coffee,
  // and is also likelier to be a real duplicate rather than a real pair.
  return groups.sort((a, b) => Math.abs(b.original.amount) - Math.abs(a.original.amount));
}

/** How many rows would go if every copy were removed. */
export function duplicateCount(groups: DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.copies.length, 0);
}
