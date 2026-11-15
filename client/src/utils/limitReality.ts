import type { Budget, Category, Transaction } from "../api/client.js";
import { categorySlices } from "./splits.js";

/**
 * Whether each limit is a decision or a leftover.
 *
 * A budget is set once, in a hopeful mood, and then judged every month by
 * whether this month beat it. What never gets asked is whether the limit was
 * ever the right number. Takeaway at 50 a month against 222 actually spent is
 * not an overspend six months running — it is a cap nobody believes, and the
 * screen that keeps reporting it as a breach is reporting the wrong thing.
 *
 * So this compares each cap against the six complete months behind it and
 * says which of three things it is:
 *
 * - **Too tight.** Beaten by a wide margin most months. The cap is fiction,
 *   and every alert it fires is noise that teaches somebody to ignore alerts.
 * - **Too loose.** Never approached. Money notionally set aside that never
 *   moves, which makes the committed total look bigger than it is and hides
 *   surplus that could be doing something.
 * - **About right.** Occasionally bites, usually holds. That is a budget
 *   working, and it is listed rather than hidden — a list that only ever
 *   accuses is one nobody opens twice.
 *
 * Plus the two cases a cap-by-cap comparison would otherwise lose: a category
 * with real spending and **no cap at all**, and one with too little history to
 * judge, which is said rather than guessed at.
 *
 * Nothing here is applied. Every row offers a figure and the limit is set by
 * the person, the same way the adviser's proposals are.
 */

export type Verdict = "too-tight" | "too-loose" | "about-right" | "unbudgeted" | "unproven";

/**
 * How far past the cap the typical month has to land before the cap is called
 * fiction. A quarter: a budget that bites now and then is a budget doing its
 * job, so the line has to sit above "missed it slightly".
 */
export const TOO_TIGHT = 1.25;

/**
 * How far below the cap the *worst* month has to sit before the cap is called
 * slack — measured against the highest month, not the typical one, because a
 * category bought in two months of six has a typical month of nothing and a
 * real spike, and calling that slack would be wrong.
 */
export const TOO_LOOSE = 0.5;

/** Below this a month's spending is not worth a row of its own. */
export const MATERIAL = 20;

/** Fewer months with anything in them than this and there is nothing to generalise from. */
export const MIN_MONTHS = 3;

/** Complete months looked at. */
export const WINDOW = 6;

export interface LimitCheck {
  category_id: number;
  category_name: string;
  /** The cap as set, or null for a category being spent on with no cap. */
  limit: number | null;
  /** One figure per month in the window, oldest first, zero where nothing went out. */
  months: { month: string; amount: number }[];
  /** The month half the months came in under. */
  typical: number;
  mean: number;
  /**
   * What the category costs a month, spread across every month in the window.
   *
   * The larger of the typical month and the mean, for the reason
   * `defensibleLimit` takes the same pair: a category bought in two months of
   * six has a typical month of nothing, and reporting that it costs nothing a
   * month beside a suggestion to budget seventy-six for it is two figures
   * that contradict each other on one line.
   */
  monthly: number;
  highest: number;
  /** Months in the window where spending passed the cap. */
  monthsOver: number;
  /** Months in the window with any spending at all. */
  monthsActive: number;
  verdict: Verdict;
  /** A defensible cap, when the one in place is not. */
  suggested: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The six complete months before now, oldest first.
 *
 * The current month is left out because it is unfinished, and a part month
 * counted as a whole one drags every figure down and makes every cap look
 * generous — the same exclusion `analyseSpending` makes on the server.
 *
 * A fixed run of calendar months rather than "the last six months with
 * anything in them": a category last spent on in 2024 should not be judged
 * against 2024's months as though they were recent.
 */
export function completeMonths(now = new Date(), count = WINDOW): string[] {
  const months: string[] = [];
  for (let back = count; back >= 1; back--) {
    months.push(new Date(Date.UTC(now.getFullYear(), now.getMonth() - back, 1)).toISOString().slice(0, 7));
  }
  return months;
}

/**
 * A cap this category could actually live inside.
 *
 * The typical month plus a margin sized by how erratic the category is: a
 * standing charge needs almost none, and one that swings needs room or it is
 * breached in the first week and stops being used. Deliberately the same
 * formula as `baselineLimit` on the server, so a figure suggested here and one
 * the adviser proposes do not disagree about the same category.
 */
export function defensibleLimit(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  // The larger of the two: a category bought in two months of six has a
  // typical month of nothing, and a cap of nothing guarantees a breach the
  // month it comes round. The mean spreads it across the months instead,
  // which is what setting money aside for it looks like.
  const centre = Math.max(median(amounts), mean);
  // Deviation measured from the mean and divided by it, for the reason given
  // on the server: measured from a median of zero the ratio comes out at
  // exactly 1 however spiky the category is.
  const spread = amounts.reduce((sum, a) => sum + Math.abs(a - mean), 0) / amounts.length;
  const volatility = spread / (mean || 1);
  return Math.round(centre + Math.min(0.5, Math.max(0.05, volatility)) * centre);
}

/** The arithmetic on one category's months, with no names or currency in it. */
export function gradeLimit(
  amounts: number[],
  limit: number | null
): Pick<LimitCheck, "typical" | "mean" | "monthly" | "highest" | "monthsOver" | "monthsActive" | "verdict" | "suggested"> {
  const typical = round(median(amounts));
  const mean = round(amounts.reduce((sum, a) => sum + a, 0) / (amounts.length || 1));
  const highest = round(amounts.length === 0 ? 0 : Math.max(...amounts));
  const monthsActive = amounts.filter((a) => a > 0).length;
  const monthsOver = limit === null ? 0 : amounts.filter((a) => a > limit).length;
  const suggested = defensibleLimit(amounts);

  const facts = { typical, mean, monthly: Math.max(typical, mean), highest, monthsOver, monthsActive, suggested };

  if (limit === null) return { ...facts, verdict: "unbudgeted" };

  // A category seen once or twice has no shape yet, and a verdict drawn from
  // it would be a guess wearing a number. Said out loud instead, because "we
  // cannot tell yet" is information and a silent omission is not.
  if (monthsActive < MIN_MONTHS) return { ...facts, verdict: "unproven", suggested: null };

  // Over the cap in every single month counts even when the margin is small:
  // a limit breached six times out of six is not restraining anything,
  // whether it is beaten by a quarter or by a fiver.
  if (typical > limit * TOO_TIGHT || (monthsOver === amounts.length && typical > limit)) {
    return { ...facts, verdict: "too-tight" };
  }

  if (highest < limit * TOO_LOOSE) return { ...facts, verdict: "too-loose" };

  // Working. No figure offered, because there is nothing to improve on and a
  // suggestion beside a healthy cap only invites fiddling.
  return { ...facts, verdict: "about-right", suggested: null };
}

/** The order to read them in: the caps that are wrong, worst first, then the rest. */
const PRIORITY: Record<Verdict, number> = {
  "too-tight": 0,
  unbudgeted: 1,
  "too-loose": 2,
  unproven: 3,
  "about-right": 4,
};

/**
 * @param currency Only this currency's caps and spending, never converted —
 *   a sterling card has no business being measured against a euro cap, and a
 *   cap converted at today's rate moves with the exchange rate rather than
 *   with spending.
 */
export function limitReality(
  budgets: Budget[],
  transactions: Transaction[],
  categories: Category[],
  currency: string,
  now = new Date()
): LimitCheck[] {
  const months = completeMonths(now);
  const inWindow = new Set(months);
  const names = new Map(categories.map((c) => [c.id, c.name]));

  // Only reviewed rows, matching what `GET /api/budgets` counts as spent. An
  // unreviewed import counted here and not there would put two figures for
  // the same category on the same page.
  const spend = new Map<number, Map<string, number>>();
  for (const t of transactions) {
    if (t.currency !== currency || t.reviewed_at === null) continue;
    const month = t.booking_date.slice(0, 7);
    if (!inWindow.has(month)) continue;
    for (const slice of categorySlices(t)) {
      // Outflows only, and nothing uncategorised: a cap cannot be set on
      // "uncategorised", so listing it would be an accusation with no action.
      if (slice.category_id === null || slice.amount >= 0) continue;
      const byMonth = spend.get(slice.category_id) ?? new Map<string, number>();
      byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(slice.amount));
      spend.set(slice.category_id, byMonth);
    }
  }

  const limits = new Map<number, Budget>();
  for (const b of budgets) if (b.currency === currency) limits.set(b.category_id, b);

  const checks: LimitCheck[] = [];
  const considered = new Set<number>([...limits.keys(), ...spend.keys()]);

  for (const categoryId of considered) {
    const byMonth = spend.get(categoryId) ?? new Map<string, number>();
    const series = months.map((month) => ({ month, amount: round(byMonth.get(month) ?? 0) }));
    const amounts = series.map((s) => s.amount);
    const budget = limits.get(categoryId);
    const graded = gradeLimit(amounts, budget ? budget.monthly_limit : null);

    // A category with no cap and next to nothing going out of it does not
    // need one. Saying so for every stray fiver would bury the rows that
    // matter.
    if (!budget && graded.monthly < MATERIAL) continue;

    checks.push({
      category_id: categoryId,
      category_name: budget?.category_name ?? names.get(categoryId) ?? "Uncategorised",
      limit: budget ? budget.monthly_limit : null,
      months: series,
      ...graded,
    });
  }

  checks.sort((a, b) => {
    const byVerdict = PRIORITY[a.verdict] - PRIORITY[b.verdict];
    if (byVerdict !== 0) return byVerdict;
    // Within a verdict, by how much money is involved — a cap that is wrong
    // by three hundred a month is worth more attention than one wrong by ten.
    // Spread across the months rather than the median one, so an occasional
    // cost is not ranked last for having a typical month of nothing.
    return b.monthly - a.monthly;
  });

  return checks;
}

/**
 * One plain sentence for a row, with the figures in it.
 *
 * A verdict on its own is an opinion. The point of saying "over in six of the
 * last six months" is that it can be checked, and disagreed with.
 */
export function limitNote(check: LimitCheck, money: (value: number) => string): string {
  const { limit, typical, monthly, highest, monthsOver, monthsActive, months, suggested } = check;
  const covered = months.length;
  /**
   * Every month in the window, or only some of them.
   *
   * It changes the wording rather than only the figure: "typically 76 a
   * month" is false of a category bought twice in six months, and the
   * honest version of the same arithmetic is what it came to and how often.
   */
  const everyMonth = monthsActive === covered;

  if (limit === null) {
    return everyMonth
      ? `No limit set, and ${money(monthly)} a month goes out. ${money(suggested ?? 0)} would cover it.`
      : `No limit set. Bought in ${monthsActive} of the last ${covered} months, ${money(highest)} at the most, which is ${money(monthly)} a month set aside — what ${money(suggested ?? 0)} would cover.`;
  }

  if (check.verdict === "unproven") {
    return monthsActive === 0
      ? `Nothing has gone out of this in ${covered} months. Either the limit is holding a place for something, or it can go.`
      : `Only ${monthsActive} month${monthsActive === 1 ? "" : "s"} of spending so far — too little to say whether ${money(limit)} is the right cap.`;
  }

  if (check.verdict === "too-tight") {
    const over = `Over in ${monthsOver} of the last ${covered} months`;
    return `${over}, typically ${money(typical)} against a ${money(limit)} cap. ${money(suggested ?? 0)} is what this actually costs.`;
  }

  if (check.verdict === "too-loose") {
    const worst = `the worst month was ${money(highest)}`;
    return `${money(limit)} set aside and ${worst}. Dropping it to ${money(suggested ?? 0)} frees ${money(Math.max(0, limit - (suggested ?? 0)))} a month.`;
  }

  if (monthsOver > 0) {
    return `Over in ${monthsOver} of ${covered} months, typically ${money(typical)} against ${money(limit)}. A cap that bites now and then is a cap doing its job.`;
  }
  return everyMonth
    ? `Under ${money(limit)} every month, typically ${money(typical)}. Working.`
    : `Under ${money(limit)} every month it came round — ${monthsActive} of the last ${covered}, ${money(monthly)} a month across all six. Working.`;
}
