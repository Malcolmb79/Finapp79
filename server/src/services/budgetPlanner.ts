/**
 * What each category actually costs, month by month.
 *
 * The figures a budget conversation needs are arithmetic, not judgement: what
 * a category typically costs, whether it is steady or erratic, and which way
 * it has been moving. Those are computed here so the advice built on them is
 * built on something checkable — the same division the debt adviser uses.
 *
 * A budget set from an average is set too low half the time, which is how
 * budgets get abandoned. So the headline figure is the median month: the
 * amount half the months come in under.
 */

export interface CategorySpend {
  category: string;
  /** Months with any spending, oldest first. */
  months: { month: string; amount: number }[];
  /** The month half the months come in under. */
  typical: number;
  mean: number;
  highest: number;
  lowest: number;
  /** Most recent full month's spend, for "is this month unusual". */
  latest: number;
  /**
   * How much month-to-month variation there is, as a share of the typical
   * month. A standing charge sits near 0; a category driven by one-offs runs
   * high. Budgeting advice differs completely between the two.
   */
  volatility: number;
  /** Change per month across the period, as a share of the typical month. */
  trend: number;
  transactions: number;
}

export interface SpendingAnalysis {
  monthsCovered: string[];
  categories: CategorySpend[];
  /** Median monthly income across the period. */
  typicalIncome: number;
  /** Median monthly outgoings across the period. */
  typicalSpend: number;
  currency: string;
}

interface Entry {
  amount: number;
  booking_date: string;
  category: string | null;
}

const UNCATEGORISED = "Uncategorised";

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Least-squares slope per month, so a trend isn't read off two endpoints. */
export function slopePerMonth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function analyseSpending(entries: Entry[], currency: string, monthsToCover = 6): SpendingAnalysis {
  const allMonths = [...new Set(entries.map((e) => e.booking_date.slice(0, 7)))].sort();
  // The current month is deliberately excluded: it is incomplete, and a
  // part-month counted as a whole one drags every average down and makes
  // every category look like it is falling.
  const currentMonth = new Date().toISOString().slice(0, 7);
  const complete = allMonths.filter((month) => month < currentMonth);
  const monthsCovered = complete.slice(-monthsToCover);

  const inWindow = entries.filter((e) => monthsCovered.includes(e.booking_date.slice(0, 7)));

  const spendByCategory = new Map<string, Map<string, number>>();
  const countByCategory = new Map<string, number>();
  const incomeByMonth = new Map<string, number>();
  const spendByMonth = new Map<string, number>();

  for (const entry of inWindow) {
    const month = entry.booking_date.slice(0, 7);
    if (entry.amount >= 0) {
      incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + entry.amount);
      continue;
    }

    const amount = Math.abs(entry.amount);
    const category = entry.category ?? UNCATEGORISED;
    spendByMonth.set(month, (spendByMonth.get(month) ?? 0) + amount);
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);

    const byMonth = spendByCategory.get(category) ?? new Map<string, number>();
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
    spendByCategory.set(category, byMonth);
  }

  const categories: CategorySpend[] = [];
  for (const [category, byMonth] of spendByCategory) {
    // Every month in the window, including the ones with nothing spent — a
    // category bought in two months of six costs its average across six, and
    // budgeting it at the two-month figure sets it three times too high.
    const series = monthsCovered.map((month) => ({ month, amount: round(byMonth.get(month) ?? 0) }));
    const amounts = series.map((s) => s.amount);
    const typical = median(amounts);
    const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;

    // Mean absolute deviation around the mean, over the mean. Deviation is
    // measured from the same centre it is divided by, which matters for a
    // category bought in only some months: measured from the median — zero
    // for those — the ratio comes out at exactly 1 however spiky it is, so
    // once-a-year and twice-a-month look identical.
    const spread = amounts.reduce((sum, a) => sum + Math.abs(a - mean), 0) / amounts.length;
    const base = mean || 1;

    categories.push({
      category,
      months: series,
      typical: round(typical),
      mean: round(mean),
      highest: round(Math.max(...amounts)),
      lowest: round(Math.min(...amounts)),
      latest: round(amounts[amounts.length - 1] ?? 0),
      volatility: round(spread / base),
      trend: round(slopePerMonth(amounts) / base),
      transactions: countByCategory.get(category) ?? 0,
    });
  }

  categories.sort((a, b) => b.typical - a.typical);

  return {
    monthsCovered,
    categories,
    typicalIncome: round(median(monthsCovered.map((m) => incomeByMonth.get(m) ?? 0))),
    typicalSpend: round(median(monthsCovered.map((m) => spendByMonth.get(m) ?? 0))),
    currency,
  };
}

/**
 * A defensible limit for a category before anyone has advised anything.
 *
 * The typical month plus a margin sized by how erratic the category is: a
 * standing charge needs almost none, and a category that swings needs room or
 * the budget is breached in the first week and stops being used.
 *
 * This exists so a recommendation is never the only number available — it is
 * the baseline any advice has to improve on, and it is here rather than in a
 * prompt so it can be checked.
 */
export function baselineLimit(spend: CategorySpend): number {
  // The larger of typical and mean: a category bought in two months of six
  // has a typical month of nothing, and budgeting it at nothing guarantees a
  // breach the month it comes round. The mean spreads it across the months
  // instead, which is what setting money aside for it looks like.
  const centre = Math.max(spend.typical, spend.mean);
  const margin = Math.min(0.5, Math.max(0.05, spend.volatility)) * centre;
  return Math.round(centre + margin);
}
