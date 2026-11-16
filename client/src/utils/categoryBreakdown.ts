import { cleanDescription } from "./cleanDescription.js";
import { merchantKey } from "./recurring.js";

/**
 * What one category is actually made of.
 *
 * A category total answers how much, and stops exactly where the useful
 * question starts. "Groceries, €612" is a figure nobody can act on: it is
 * either four big shops or forty small ones, either steady for a year or up a
 * third since August, and those are four different problems with four
 * different answers. The total is identical in every one of them.
 *
 * So this breaks one category three ways — by month, by who was paid, and by
 * the size of the individual payments — because those are the three shapes a
 * category's spending comes in and each is invisible inside the others.
 */

export interface CategoryTransaction {
  amount: number;
  booking_date: string;
  description: string | null;
  counterparty: string | null;
  category_id: number | null;
}

export interface MonthTotal {
  month: string;
  total: number;
  count: number;
}

export interface PayeeTotal {
  label: string;
  total: number;
  count: number;
}

export interface CategoryBreakdown {
  /** Everything spent, as a positive number. */
  total: number;
  count: number;
  /** Per month of history touched — not per month of window, see below. */
  monthlyAverage: number;
  /** The middle payment, which says far more about the shape than the mean. */
  typical: number;
  largest: number;
  months: MonthTotal[];
  payees: PayeeTotal[];
  /**
   * Money *in* under this category, kept apart rather than netted off.
   *
   * A refund is not negative spending. Netting one against the month's
   * shopping reports a cheaper month than happened and hides both facts;
   * a category with refunds in it has two figures, and both are worth seeing.
   */
  refunds: number;
  refundCount: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Who was paid, grouped the way the subscription detector groups them.
 *
 * `merchantKey` strips the references and store numbers that differ every
 * time, so "TESCO STORES 3288" and "TESCO STORES 4471" are one payee. Without
 * that the list is forty rows of the same shop and says nothing at all —
 * which is the failure mode this whole breakdown exists to avoid.
 */
function payeeTotals(transactions: CategoryTransaction[]): PayeeTotal[] {
  const groups = new Map<string, { label: string; total: number; count: number }>();

  for (const tx of transactions) {
    const key = merchantKey(tx) || "unnamed";
    const label = cleanDescription(tx.description) || tx.counterparty || "Unnamed";
    const entry = groups.get(key) ?? { label, total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    groups.set(key, entry);
  }

  return [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function categoryBreakdown(transactions: CategoryTransaction[], categoryId: number): CategoryBreakdown {
  const mine = transactions.filter((tx) => tx.category_id === categoryId);
  const out = mine.filter((tx) => tx.amount < 0);
  const back = mine.filter((tx) => tx.amount > 0);

  const amounts = out.map((tx) => Math.abs(tx.amount));
  const total = amounts.reduce((sum, amount) => sum + amount, 0);

  const byMonth = new Map<string, { total: number; count: number }>();
  for (const tx of out) {
    const month = tx.booking_date.slice(0, 7);
    const entry = byMonth.get(month) ?? { total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    byMonth.set(month, entry);
  }
  const months = [...byMonth.entries()]
    .map(([month, entry]) => ({ month, ...entry }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    total,
    count: out.length,
    // Divided by the months that actually have spending in them, not by the
    // length of the window. A category used twice a year averaged over twelve
    // months reports a figure that is true of no month it ever happened in.
    monthlyAverage: months.length > 0 ? total / months.length : 0,
    typical: median(amounts),
    largest: amounts.length > 0 ? Math.max(...amounts) : 0,
    months,
    payees: payeeTotals(out),
    refunds: back.reduce((sum, tx) => sum + tx.amount, 0),
    refundCount: back.length,
  };
}
