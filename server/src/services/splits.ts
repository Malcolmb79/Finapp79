/**
 * Reading a transaction by category.
 *
 * A transaction normally answers "which category?" with one answer. A split
 * one answers with several, and every total in the app that groups by category
 * has to ask the same way or two screens will disagree about the same money.
 * So nothing groups by `category_id` directly any more — it goes through
 * `categorySlices`, which gives one answer for an ordinary transaction and
 * several for a split one.
 *
 * The parent transaction keeps its own amount and category. A split is a
 * finer reading of the same money, not a replacement for it, which is what
 * makes it undoable: delete the splits and the transaction is what it was.
 */

export interface Split {
  category_id: number | null;
  amount: number;
}

/** A transaction's amount broken into the categories it belongs to. */
export interface CategorySlice {
  category_id: number | null;
  amount: number;
}

/**
 * Money is stored in floating point, so "the parts add up" cannot be an
 * equality test: 33.33 + 33.33 + 33.34 is not 100 to a computer. A tenth of a
 * cent is below the smallest unit anyone can actually enter.
 */
export const SPLIT_TOLERANCE = 0.005;

export function splitsBalance(total: number, splits: Split[]): boolean {
  const sum = splits.reduce((running, split) => running + split.amount, 0);
  return Math.abs(sum - total) < SPLIT_TOLERANCE;
}

/**
 * What this transaction contributes to each category.
 *
 * An unsplit transaction yields exactly what it did before — one slice, its
 * own amount and category — so every caller can route through this without a
 * special case, and an unsplit app behaves identically to one that never
 * heard of splits.
 */
export function categorySlices<T extends { category_id: number | null; amount: number; splits?: Split[] | null }>(
  transaction: T
): CategorySlice[] {
  const splits = transaction.splits;
  if (!splits || splits.length === 0) {
    return [{ category_id: transaction.category_id, amount: transaction.amount }];
  }
  return splits.map((split) => ({ category_id: split.category_id, amount: split.amount }));
}

/** Every slice of every transaction, flattened. */
export function allCategorySlices<T extends { category_id: number | null; amount: number; splits?: Split[] | null }>(
  transactions: T[]
): CategorySlice[] {
  return transactions.flatMap(categorySlices);
}
