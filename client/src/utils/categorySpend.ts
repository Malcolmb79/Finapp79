import type { FlowKind } from "./monthlyFlow.js";

/**
 * What each category cost, which is not the same as what was paid out of it.
 *
 * Three screens built this figure independently — the Analytics donut, its
 * bar list and table, and the Dashboard's own spend-by-category widget — and
 * all three totalled the debits and ignored the credits. So a page could
 * print €453.97 of category spending above a €417.65 expenses headline, with
 * nothing on it saying why the two disagreed, and the gap was a refund the
 * reader had no way to see.
 *
 * A refund is money coming back *to the thing it was spent on*: €40 back on
 * transport means transport cost €40, not €80. Netting it is what makes a
 * category total answer "what did this cost me", which is the question the
 * chart is being asked, and what makes the shares add up to the expenses
 * figure beside them.
 *
 * Two rules it does not break:
 *
 *   **An unfiled credit never nets.** "Uncategorised" is the absence of a
 *   relationship rather than a relationship, so setting one unknown credit
 *   against unrelated unknown spending would invent the connection — the same
 *   rule the flow chart and `monthlyFlow` live under.
 *
 *   **Nothing is hidden.** `refunded` is reported so the screen can say what
 *   it took off, and a category that took back more than it ever spent is
 *   named in `overRefunded` rather than drawn as a negative bar. Netting in
 *   silence would trade one invisible fact for another; the detail itself
 *   lives in `categoryBreakdown.ts`, which reports a category's refunds
 *   separately and is one click away from every one of these charts.
 */

export interface SpendRow {
  categoryId: number | null;
  name: string;
  /** What it cost: what went out, less what came back to it. */
  total: number;
  /** Payments out, not counting the refunds. */
  count: number;
  /** What came back, already taken off `total`. */
  refunded: number;
}

export interface CategorySpend {
  /** Categories that cost something, largest first. */
  rows: SpendRow[];
  /** The sum of `rows`, which is what the shares are shares of. */
  total: number;
  /** Everything netted off, so a screen can say what it took away. */
  refunded: number;
  /** Took back more than it ever spent, so it is in no row. */
  overRefunded: { name: string; amount: number }[];
}

interface Spendable {
  amount: number;
  category_id?: number | null;
}

/** The key an uncategorised row groups under, since `null` is not a Map key worth sharing. */
const UNFILED = "__unfiled";

export function categorySpend(
  transactions: Spendable[],
  name: (id: number | null) => string,
  kind: (id: number | null) => FlowKind | null = () => null
): CategorySpend {
  const buckets = new Map<number | string, { categoryId: number | null; debits: number; credits: number; count: number }>();

  const bucket = (id: number | null) => {
    const key = id ?? UNFILED;
    const found = buckets.get(key) ?? { categoryId: id, debits: 0, credits: 0, count: 0 };
    buckets.set(key, found);
    return found;
  };

  for (const tx of transactions) {
    const id = tx.category_id ?? null;
    const info = kind(id);
    // A transfer is not spending and a salary is not a refund of one.
    if (info?.isTransfer) continue;

    if (tx.amount < 0) {
      const entry = bucket(id);
      entry.debits += Math.abs(tx.amount);
      entry.count += 1;
      continue;
    }

    // Credits only come back to a category that was named. An income credit
    // is income, and an unfiled one is attached to nothing.
    if (tx.amount > 0 && id != null && !info?.countsAsIncome) bucket(id).credits += tx.amount;
  }

  const rows: SpendRow[] = [];
  const overRefunded: { name: string; amount: number }[] = [];
  let refunded = 0;

  for (const entry of buckets.values()) {
    const net = entry.debits - entry.credits;
    const label = name(entry.categoryId);
    if (net > 0.005) {
      refunded += entry.credits;
      rows.push({ categoryId: entry.categoryId, name: label, total: net, count: entry.count, refunded: entry.credits });
      continue;
    }
    /**
     * Took back at least everything it spent. Drawn as a bar it would be
     * negative or zero-width, and a chart of magnitudes has no honest way to
     * show that — so it is named instead.
     *
     * Unless it never spent anything, in which case it did not "take back"
     * anything either: it is a category that only ever receives. Saying
     * "Salary took back €2,184 more than it spent" of a month's wages is a
     * sentence about a refund that did not happen. Those credits are income
     * or `otherIn`, which is `monthlyFlow`'s question, not this one — a
     * spend-by-category chart has nothing to say about them.
     */
    if (entry.credits > 0.005 && entry.debits > 0.005) {
      refunded += entry.debits;
      overRefunded.push({ name: label, amount: entry.credits - entry.debits });
    }
  }

  rows.sort((a, b) => b.total - a.total);
  overRefunded.sort((a, b) => b.amount - a.amount);

  return { rows, total: rows.reduce((sum, r) => sum + r.total, 0), refunded, overRefunded };
}
