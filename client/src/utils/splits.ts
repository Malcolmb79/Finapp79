import type { Transaction } from "../api/client.js";

/**
 * Reading a transaction by category.
 *
 * Mirrors the server's services/splits.ts, and exists for the same reason:
 * a transaction normally answers "which category?" with one answer, a split
 * one answers with several, and every total that groups by category has to ask
 * the same way or two screens disagree about the same money.
 *
 * An unsplit transaction yields exactly one slice — its own amount and
 * category — so callers need no special case and an app with no splits in it
 * behaves identically to one that never heard of them.
 */

export interface CategorySlice {
  category_id: number | null;
  amount: number;
  /** The transaction it came from, for drilling back through to it. */
  transaction: Transaction;
}

export function categorySlices(transaction: Transaction): CategorySlice[] {
  const splits = transaction.splits;
  if (!splits || splits.length === 0) {
    return [{ category_id: transaction.category_id, amount: transaction.amount, transaction }];
  }
  return splits.map((split) => ({ category_id: split.category_id, amount: split.amount, transaction }));
}

export function allCategorySlices(transactions: Transaction[]): CategorySlice[] {
  return transactions.flatMap(categorySlices);
}

/**
 * Money is stored in floating point, so "the parts add up" cannot be an
 * equality test: 33.33 + 33.33 + 33.34 is not 100 to a computer. A tenth of a
 * cent is below the smallest unit anyone can enter.
 */
export const SPLIT_TOLERANCE = 0.005;

export function splitsBalance(total: number, amounts: number[]): boolean {
  return Math.abs(amounts.reduce((running, amount) => running + amount, 0) - total) < SPLIT_TOLERANCE;
}

/** What is still unaccounted for, so a split UI can say so as it is typed. */
export function splitRemainder(total: number, amounts: number[]): number {
  return total - amounts.reduce((running, amount) => running + amount, 0);
}
