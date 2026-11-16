import type { Category, Transaction } from "../api/client.js";

/**
 * Money moving between your own accounts, which is neither income nor
 * spending.
 *
 * A transfer is one event wearing two faces: €2,000 leaves the current
 * account and the same €2,000 arrives in the savings account. Both are real
 * rows and both have to stay — the balances depend on them — but counted as
 * income and spending they double-report a month. A household moving €2,000
 * to savings every month reads as earning €2,000 more and spending €2,000
 * more than it did, and a savings rate computed from those two figures is
 * wrong in the numerator and the denominator at once.
 *
 * The app already reasons exactly this way about a loan repayment, which is
 * also one event in two places — `spendingTransactions` drops it from
 * spending and `repaymentMirrors` restores the other half for net worth.
 * This is the same move for the general case.
 *
 * Two ways a transfer gets identified, and they are deliberately different
 * kinds of thing:
 *
 *   **A category flag** is a standing statement: everything filed under
 *   "Transfers" is one. It needs no matching and no confirmation, and it is
 *   what somebody who already categorises their transfers has effectively
 *   declared.
 *
 *   **A matched pair** is a suggestion: this payment out and that payment in
 *   look like the same money. It is never applied on its own, because two
 *   payments of the same size a day apart are sometimes exactly that.
 */

export function transferCategoryIds(categories: Category[]): Set<number> {
  return new Set(categories.filter((c) => c.is_transfer).map((c) => c.id));
}

/**
 * Whether this row is a movement between the household's own accounts.
 *
 * Reads the transaction's own category only. A split transaction with one leg
 * in a transfer category is not handled — a payment that is partly a transfer
 * and partly a purchase is a real thing and a rare one, and guessing at it
 * here would be worse than leaving it visible.
 */
export function isTransfer(
  transaction: { category_id: number | null },
  transferIds: Set<number>
): boolean {
  return transaction.category_id !== null && transferIds.has(transaction.category_id);
}

/**
 * The transactions that represent money genuinely entering or leaving the
 * household.
 *
 * Every income figure, spending figure, savings rate and category total has
 * to come through here or it will disagree with the ones that do — the same
 * rule the net worth figures already live under, learned the same way.
 */
export function excludeTransfers<T extends { category_id: number | null }>(
  transactions: T[],
  transferIds: Set<number>
): T[] {
  if (transferIds.size === 0) return transactions;
  return transactions.filter((transaction) => !isTransfer(transaction, transferIds));
}

/* ------------------------------------------------------------- matching */

/** How many days apart the two halves of one transfer can land. */
export const PAIR_WINDOW_DAYS = 4;

/**
 * How far apart the two amounts may be, as a fraction.
 *
 * Not zero: a transfer between currencies, or one that attracts a fee,
 * arrives slightly smaller than it left. Small, though — at 5% a €500 payment
 * would match anything from €475 to €525, which on a busy account is most
 * things.
 */
export const PAIR_TOLERANCE = 0.02;

export interface TransferPair {
  /** Stable, so a dismissal can be remembered against it. */
  key: string;
  out: Transaction;
  in: Transaction;
  /** Days between the two halves. */
  daysApart: number;
  /** The difference between the two amounts, which a fee or an FX rate explains. */
  gap: number;
  /** Already filed under a transfer category — so the pair is a confirmation, not news. */
  alreadyMarked: boolean;
}

function daysBetween(from: string, to: string): number {
  return Math.abs(Date.parse(to) - Date.parse(from)) / 86_400_000;
}

/**
 * Payments out matched to payments in that look like the same money.
 *
 * Deliberately conservative. The two halves must be on **different accounts**
 * — a payment and a refund on one card is not a transfer — within a few days,
 * and close in amount. Each row is used at most once, best match first, so
 * one payment out cannot be offered as the partner of three different
 * payments in.
 *
 * What it will not do is decide. Two accounts, four days and a matching
 * amount describes a transfer and also describes paying a builder who banks
 * with you; only the owner knows which. So this produces candidates and the
 * screen asks.
 */
export function findTransferPairs(transactions: Transaction[], transferIds: Set<number> = new Set()): TransferPair[] {
  const outs = transactions.filter((t) => t.amount < 0).sort((a, b) => a.booking_date.localeCompare(b.booking_date));
  const ins = transactions.filter((t) => t.amount > 0);
  const takenIn = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outs) {
    const amount = Math.abs(out.amount);
    if (amount === 0) continue;

    let best: { tx: Transaction; days: number; gap: number } | null = null;
    for (const candidate of ins) {
      if (takenIn.has(candidate.id)) continue;
      // The same account is not a transfer. A refund, a reversal and a
      // correction all look like this and none of them is money moving house.
      if (candidate.account_id === out.account_id) continue;

      const days = daysBetween(out.booking_date, candidate.booking_date);
      if (days > PAIR_WINDOW_DAYS) continue;

      const gap = Math.abs(candidate.amount - amount);
      if (gap / amount > PAIR_TOLERANCE) continue;

      // Closest in amount first, then closest in time — a fee-sized
      // difference is more telling than a day.
      if (!best || gap < best.gap || (gap === best.gap && days < best.days)) {
        best = { tx: candidate, days, gap };
      }
    }

    if (!best) continue;
    takenIn.add(best.tx.id);
    pairs.push({
      key: [out.id, best.tx.id].sort().join("~"),
      out,
      in: best.tx,
      daysApart: Math.round(best.days),
      gap: Math.round(best.gap * 100) / 100,
      alreadyMarked: isTransfer(out, transferIds) && isTransfer(best.tx, transferIds),
    });
  }

  return pairs.sort((a, b) => b.out.booking_date.localeCompare(a.out.booking_date));
}

/** What a pair is worth saying in one line. */
export function pairNote(pair: TransferPair, money: (value: number) => string): string {
  const when = pair.daysApart === 0 ? "the same day" : `${pair.daysApart} day${pair.daysApart === 1 ? "" : "s"} later`;
  if (pair.gap === 0) return `${money(Math.abs(pair.out.amount))} out, the same in ${when}.`;
  // Named rather than hidden: a gap is usually a fee or an exchange rate, and
  // occasionally it is the sign that these are two different payments.
  return `${money(Math.abs(pair.out.amount))} out, ${money(pair.in.amount)} in ${when} — ${money(pair.gap)} apart, which a fee or an exchange rate would explain.`;
}
