/**
 * This month against last, by category.
 *
 * The one comparison people make unprompted — "am I spending more than I
 * usually do?" — and the one the app had no answer to. A total for the month
 * cannot answer it, because a total is only high or low relative to something.
 *
 * **The whole difficulty is that this month is not finished.** Set eleven days
 * against thirty and every category falls, every month, until the last day —
 * a chart that reports an improvement which is only the calendar. So the
 * comparison is to the *same stretch* of last month: eleven days against the
 * first eleven days. That makes the two sides answer the same question, and
 * it is why these functions take a date rather than just a month.
 */

export interface MonthRow {
  key: string;
  label: string;
  now: number;
  before: number;
  /** Positive is more spent than the same stretch last month. */
  delta: number;
}

export interface MonthComparison {
  rows: MonthRow[];
  now: number;
  before: number;
  delta: number;
  /** How many days of this month the comparison covers. */
  days: number;
  /** True while the month is still running, so the figures are to date. */
  partial: boolean;
}

interface Spendable {
  amount: number;
  booking_date: string;
  category_id: number | null;
}

/** The month a date falls in, as `YYYY-MM`. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** The month before the one this date falls in. */
export function previousMonth(date: string): string {
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** How many days of the month this date is into it. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * The comparison, as at a date.
 *
 * `asAt` is normally today. Last month is cut to the same day of the month, so
 * a month part-way through is set against the same part of the one before it.
 * A finished month is compared whole, because then there is nothing to cut.
 */
export function compareMonths(
  transactions: Spendable[],
  categoryName: (id: number | null) => string | null,
  asAt: string,
  isMonthComplete = false
): MonthComparison {
  const thisMonth = monthKey(asAt);
  const lastMonth = previousMonth(asAt);
  const days = dayOfMonth(asAt);

  const totals = new Map<string, MonthRow>();
  let now = 0;
  let before = 0;

  for (const tx of transactions) {
    // Spending only. Income belongs in its own comparison, and mixing the two
    // would have a bonus read as a month of restraint.
    if (tx.amount >= 0) continue;
    const spent = Math.abs(tx.amount);
    const month = monthKey(tx.booking_date);

    const inNow = month === thisMonth;
    // The cut that makes the two sides comparable.
    const inBefore = month === lastMonth && (isMonthComplete || dayOfMonth(tx.booking_date) <= days);
    if (!inNow && !inBefore) continue;

    const label = categoryName(tx.category_id) ?? "Uncategorised";
    const key = label.toLowerCase();
    const row = totals.get(key) ?? { key, label, now: 0, before: 0, delta: 0 };
    if (inNow) {
      row.now += spent;
      now += spent;
    } else {
      row.before += spent;
      before += spent;
    }
    totals.set(key, row);
  }

  const rows = [...totals.values()]
    .map((row) => ({ ...row, delta: row.now - row.before }))
    // Biggest movement first, up or down: the question is what changed, and a
    // category that fell by two hundred is as much of an answer as one that
    // rose by two hundred.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { rows, now, before, delta: now - before, days, partial: !isMonthComplete };
}
