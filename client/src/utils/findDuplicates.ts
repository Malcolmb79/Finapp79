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
 *
 * ## Why a day apart counts too
 *
 * The pending copy and the booked copy are not the same row twice. The bank
 * announces the payment, then records it, and the two carry different dates,
 * different references, and descriptions truncated at different lengths -
 * "help.hbomax.co" against "help.hbomax.com". Requiring the same calendar day
 * missed every one of those, which is most of them.
 *
 * So a second, narrower rule runs beside the first: within a few days, same
 * account, same amount, and one description a truncation of the other.
 *
 * That last condition is doing the real work, and it has to be a truncation
 * rather than a match. Two identical descriptions days apart are two coffees,
 * which is why the same-amount-different-day case was excluded in the first
 * place and still is. A description the bank cut at two different lengths is
 * not something a shop does twice - it is one payment described by two
 * pipelines. The difference between the copies is the evidence.
 *
 * The same-day rule stays as it was and asks nothing of the description,
 * since a date and an amount matching exactly is already the strong case.
 */

export interface DuplicateGroup {
  /** The one that arrived first, kept as the original. */
  original: Transaction;
  /** The later arrivals, offered for removal. */
  copies: Transaction[];
  /**
   * Which rule matched, so the screen can say why rather than asserting a
   * duplicate flatly. A pair days apart deserves a longer look than a pair on
   * one day.
   */
  kind: "same-day" | "days-apart";
}

/** How far apart two copies of one payment can be booked. */
const NEAR_DAYS = 4;

/**
 * The shortest description that can stand as evidence on its own.
 *
 * A three-character prefix matches half the ledger. Six is enough to identify
 * a merchant and short enough to catch a badly truncated one.
 */
const MIN_PREFIX = 6;

function normalise(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 .]/g, "")
    .trim();
}

/**
 * Whether one description is the other cut short.
 *
 * Deliberately false for two identical descriptions. Identical is what two
 * genuine repeat purchases look like; a string cut at two different lengths
 * is what one payment looks like when two pipelines describe it, which is the
 * case this rule exists to find.
 */
export function isTruncationOf(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y || x === y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}

/** Whole days between two ISO dates, however they are ordered. */
export function daysApart(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
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
  // Same account and same amount to the penny is the floor for both rules;
  // the date and the description decide which of the two applies.
  const buckets = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    // A zero-amount row carries no evidence: every one of them would match
    // every other on the same day.
    if (tx.amount === 0) continue;
    const key = `${tx.account_id}|${tx.amount.toFixed(2)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), tx]);
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    // Oldest booking first, and within a day the one that arrived first, so a
    // group is always built around the copy that was there first.
    const ordered = [...bucket].sort((a, b) => a.booking_date.localeCompare(b.booking_date) || arrivedFirst(a, b));

    const taken = new Set<string>();
    for (const original of ordered) {
      if (taken.has(original.id)) continue;
      const copies: Transaction[] = [];
      let kind: DuplicateGroup["kind"] = "same-day";

      for (const other of ordered) {
        if (other.id === original.id || taken.has(other.id)) continue;
        const gap = daysApart(original.booking_date, other.booking_date);
        if (gap === 0) {
          copies.push(other);
          continue;
        }
        // Days apart has to clear a higher bar, because an identical amount
        // at the same shop two days running is a real pair of payments.
        if (gap <= NEAR_DAYS && isTruncationOf(original.description, other.description)) {
          copies.push(other);
          kind = "days-apart";
        }
      }

      if (copies.length === 0) continue;
      taken.add(original.id);
      for (const copy of copies) taken.add(copy.id);
      groups.push({ original, copies, kind });
    }
  }

  // Largest first: a duplicated salary matters more than a duplicated coffee,
  // and is also likelier to be a real duplicate rather than a real pair.
  return groups.sort((a, b) => Math.abs(b.original.amount) - Math.abs(a.original.amount));
}

/** How many rows would go if every copy were removed. */
export function duplicateCount(groups: DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.copies.length, 0);
}
