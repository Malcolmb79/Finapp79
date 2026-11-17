import type { Category, FxRates, Transaction } from "../api/client.js";
import { toBase } from "./fx.js";

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
 * Not zero: a transfer that attracts a fee arrives slightly smaller than it
 * left. Small, though — at 5% a €500 payment would match anything from €475
 * to €525, which on a busy account is most things.
 */
export const PAIR_TOLERANCE = 0.02;

/**
 * The same, for a transfer that changed currency on the way.
 *
 * Wider on purpose, and it is not a looser standard — it is the same standard
 * applied to a figure that has more in it. A cross-currency transfer pays the
 * bank's spread, which is a per cent or two on its own and more at a retail
 * bank; the two legs post on different days, so the rate itself has moved;
 * and the rate this app converts with is today's, not the one the transfer
 * actually got. At 2% a real £1,400 to €1,605 move does not match, and the
 * pair never gets offered at all.
 *
 * Affordable because the match is only ever a suggestion: every pair is
 * confirmed one at a time, the gap is printed beside it, and nothing moves
 * until somebody says so.
 */
export const PAIR_FX_TOLERANCE = 0.06;

export interface TransferPair {
  /** Stable, so a dismissal can be remembered against it. */
  key: string;
  out: Transaction;
  in: Transaction;
  /** Days between the two halves. */
  daysApart: number;
  /** The difference between the two amounts, which a fee or an FX rate explains. */
  gap: number;
  /**
   * The currency `gap` is expressed in — the base, where the two legs were
   * converted to compare them, and the legs' own otherwise.
   */
  gapCurrency: string;
  /** The two legs are in different currencies, so the gap includes the spread. */
  crossCurrency: boolean;
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
export function findTransferPairs(
  transactions: Transaction[],
  transferIds: Set<number> = new Set(),
  rates: FxRates | null = null
): TransferPair[] {
  const outs = transactions.filter((t) => t.amount < 0).sort((a, b) => a.booking_date.localeCompare(b.booking_date));
  const ins = transactions.filter((t) => t.amount > 0);
  const takenIn = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outs) {
    const amount = Math.abs(out.amount);
    if (amount === 0) continue;
    const outInBase = toBase(amount, out.currency, rates);

    let best: { tx: Transaction; days: number; gap: number; cross: boolean } | null = null;
    for (const candidate of ins) {
      if (takenIn.has(candidate.id)) continue;
      // The same account is not a transfer. A refund, a reversal and a
      // correction all look like this and none of them is money moving house.
      if (candidate.account_id === out.account_id) continue;

      const days = daysBetween(out.booking_date, candidate.booking_date);
      if (days > PAIR_WINDOW_DAYS) continue;

      const cross = candidate.currency !== out.currency;

      /**
       * The two legs are compared by **what they were worth**, not by the
       * number printed on them.
       *
       * Comparing the bare figures is wrong in both directions at once on a
       * household holding euro, sterling and rand. It never matches the
       * transfer that actually happened — £1,400 leaving and €1,605 arriving
       * is 15% apart as a number and the same money as a fact — and it will
       * cheerfully match £1,400 out to €1,400 in, which is two different
       * sums that merely print alike.
       *
       * With no rates, a cross-currency pair is refused outright rather than
       * guessed at. The one comparison available is the bare figures, and on
       * those the only pairs it can find are the false ones.
       */
      let gap: number;
      let scale: number;
      if (!cross) {
        gap = Math.abs(candidate.amount - amount);
        scale = amount;
      } else {
        const inInBase = toBase(candidate.amount, candidate.currency, rates);
        if (outInBase == null || inInBase == null) continue;
        gap = Math.abs(inInBase - outInBase);
        scale = outInBase;
      }

      if (scale === 0) continue;
      if (gap / scale > (cross ? PAIR_FX_TOLERANCE : PAIR_TOLERANCE)) continue;

      // Closest in amount first, then closest in time — a fee-sized
      // difference is more telling than a day. A same-currency match beats a
      // cross-currency one outright: its gap means a fee, where the other's
      // is mostly a spread nobody can check from here.
      const better =
        !best ||
        (best.cross && !cross) ||
        (best.cross === cross && (gap < best.gap || (gap === best.gap && days < best.days)));
      if (better) best = { tx: candidate, days, gap, cross };
    }

    if (!best) continue;
    takenIn.add(best.tx.id);
    pairs.push({
      key: [out.id, best.tx.id].sort().join("~"),
      out,
      in: best.tx,
      daysApart: Math.round(best.days),
      gap: Math.round(best.gap * 100) / 100,
      gapCurrency: best.cross ? (rates?.base ?? out.currency) : out.currency,
      crossCurrency: best.cross,
      alreadyMarked: isTransfer(out, transferIds) && isTransfer(best.tx, transferIds),
    });
  }

  return pairs.sort((a, b) => b.out.booking_date.localeCompare(a.out.booking_date));
}

/** What a pair is worth saying in one line. */
export function pairNote(
  pair: TransferPair,
  money: (value: number, currency: string) => string
): string {
  const when = pair.daysApart === 0 ? "the same day" : `${pair.daysApart} day${pair.daysApart === 1 ? "" : "s"} later`;
  const left = money(Math.abs(pair.out.amount), pair.out.currency);
  const arrived = money(pair.in.amount, pair.in.currency);

  /**
   * A cross-currency pair says so, and says what it was compared on.
   *
   * "£1,400 out, €1,605 in" looks like two unrelated payments until the
   * sentence says the two were converted and came to within a few euro of
   * each other. The gap is the bank's spread and a day's rate movement, and
   * naming it is what lets somebody reject the pair where it is too large to
   * be either.
   */
  if (pair.crossCurrency) {
    const apart = pair.gap === 0 ? "the same" : `${money(pair.gap, pair.gapCurrency)} apart`;
    return `${left} out, ${arrived} in ${when} — ${apart} once converted, which a bank's exchange spread would explain.`;
  }

  if (pair.gap === 0) return `${left} out, the same in ${when}.`;
  // Named rather than hidden: a gap is usually a fee or an exchange rate, and
  // occasionally it is the sign that these are two different payments.
  return `${left} out, ${arrived} in ${when} — ${money(pair.gap, pair.gapCurrency)} apart, which a fee or an exchange rate would explain.`;
}
