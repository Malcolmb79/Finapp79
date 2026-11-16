/**
 * The figures a dashboard header strip carries.
 *
 * Gathered here rather than computed inline so the one thing that makes a
 * strip like this misleading can be handled once: **the tiles are not all the
 * same kind of number.** Income and spending are flows — what moved during a
 * month. Debt and savings are stocks — what stands right now. A budget is
 * neither; it is a decision about a month that has not finished.
 *
 * Putting five such figures in a row of identical pills, as every template
 * does, invites reading them as one set. They are three. So each one comes
 * back with the period it describes attached, and the screen prints it.
 */

export type Basis = "month" | "now" | "plan";

export interface SummaryFigure {
  key: string;
  label: string;
  amount: number;
  /** What the figure is a measure of, so the card can say so rather than imply. */
  basis: Basis;
  /** A second line: a count, a comparison, a share. Null when there is nothing worth adding. */
  detail: string | null;
  tone?: "good" | "bad";
}

export interface Entry {
  amount: number;
  booking_date: string;
  category_id?: number | null;
}

export const BASIS_LABEL: Record<Basis, string> = {
  month: "this month",
  now: "right now",
  plan: "budgeted",
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function monthKeyOf(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export interface SummaryInput {
  /** Already converted to one currency, and already excluding transfers between your own accounts. */
  entries: Entry[];
  month: string;
  /** Sum of every monthly cap, in the same currency. */
  budgeted: number;
  /** What is owed, positive. */
  debt: number;
  /** What has been put aside towards goals. */
  saved: number;
}

/**
 * Income, spending, budget, debt and savings, each labelled with what it is.
 *
 * Spending excludes money coming in and income excludes money going out,
 * which sounds obvious and is the usual bug: a refund filed as a negative
 * expense quietly reduces the spending figure rather than appearing as the
 * inflow it is.
 */
export function summaryFigures({ entries, month, budgeted, debt, saved }: SummaryInput): SummaryFigure[] {
  const inMonth = entries.filter((e) => e.booking_date.startsWith(month));
  const income = round(inMonth.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0));
  const spent = round(inMonth.filter((e) => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0));
  const left = round(income - spent);

  return [
    {
      key: "income",
      label: "Income",
      amount: income,
      basis: "month",
      detail: `${inMonth.filter((e) => e.amount > 0).length} payments in`,
    },
    {
      key: "spent",
      label: "Spent",
      amount: spent,
      basis: "month",
      // Against income rather than against the budget: the budget may cover
      // only some categories, and a share of a partial total means nothing.
      detail: income > 0 ? `${Math.round((spent / income) * 100)}% of what came in` : null,
      tone: income > 0 && spent > income ? "bad" : undefined,
    },
    {
      key: "left",
      label: left >= 0 ? "Left over" : "Short by",
      amount: Math.abs(left),
      basis: "month",
      detail: null,
      tone: left >= 0 ? "good" : "bad",
    },
    {
      key: "budgeted",
      label: "Budgeted",
      amount: round(budgeted),
      basis: "plan",
      // The gap between what was capped and what has gone is the only thing
      // this figure is useful for on its own.
      detail: budgeted > 0 ? `${round(Math.max(0, budgeted - spent)) > 0 ? `${round(budgeted - spent)} still allowed` : "fully spent"}` : "nothing capped",
    },
    { key: "debt", label: "Owed", amount: round(debt), basis: "now", detail: null, tone: debt > 0 ? "bad" : undefined },
    { key: "saved", label: "Saved", amount: round(saved), basis: "now", detail: null, tone: saved > 0 ? "good" : undefined },
  ];
}

/* ----------------------------------------------------------- spend per day */

export interface DayPoint {
  date: string;
  /** What went out that day. */
  amount: number;
  /** What has gone out so far this month, to this day inclusive. */
  cumulative: number;
}

/**
 * Every day of the month so far, including the ones nothing happened on.
 *
 * Zero days matter: a line drawn only through the days with spending on them
 * rises smoothly and hides the shape entirely, which is that most months are
 * three or four heavy days and a lot of nothing. A quiet week should look
 * like a flat stretch, not like a missing one.
 */
export function dailySpend(entries: Entry[], month: string, now = new Date()): DayPoint[] {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];

  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // A month being lived in stops at today; a month already finished runs to
  // its end. Drawing the rest of the current month as zero would read as a
  // sudden stop in spending rather than as a month that has not happened yet.
  const isCurrent = month === monthKeyOf(now);
  const lastDay = isCurrent ? Math.min(daysInMonth, now.getDate()) : daysInMonth;

  const byDay = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.booking_date.startsWith(month) || entry.amount >= 0) continue;
    byDay.set(entry.booking_date, (byDay.get(entry.booking_date) ?? 0) + Math.abs(entry.amount));
  }

  const points: DayPoint[] = [];
  let running = 0;
  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const amount = round(byDay.get(date) ?? 0);
    running = round(running + amount);
    points.push({ date, amount, cumulative: running });
  }
  return points;
}

/* -------------------------------------------------------- income by source */

export interface Source {
  label: string;
  amount: number;
  /** Share of the month's income. */
  share: number;
  count: number;
}

/**
 * Where the month's income came from.
 *
 * Deliberately by category rather than by payer name: two payslips from one
 * employer are one source, and a bank description that carries a reference
 * number would otherwise split them into two. A category with nothing in it
 * does not appear, because a source of nothing is not a source.
 *
 * **Income is the declared thing, not the positive thing.** Every credit used
 * to count, which put refunds, reimbursed expenses and returned payments on a
 * card headed "where income came from" — a household does not earn money from
 * its own bus fares. `isIncome` reads `counts_as_income` off the category, the
 * same flag the balance projection has always used, so the two agree about
 * what a salary is.
 *
 * Returns nothing at all when no category has been marked as income. That is
 * a setup state and the card says so, rather than falling back to the sign and
 * quietly being wrong in the way this exists to fix.
 */
export function incomeBySource(
  entries: Entry[],
  month: string,
  categoryName: (id: number | null) => string,
  isIncome: (id: number | null) => boolean
): Source[] {
  const inMonth = entries.filter((e) => e.booking_date.startsWith(month) && e.amount > 0 && isIncome(e.category_id ?? null));
  const total = inMonth.reduce((sum, e) => sum + e.amount, 0);
  if (total <= 0) return [];

  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const entry of inMonth) {
    const label = categoryName(entry.category_id ?? null) || "Uncategorised";
    const current = byCategory.get(label) ?? { amount: 0, count: 0 };
    current.amount += entry.amount;
    current.count += 1;
    byCategory.set(label, current);
  }

  return [...byCategory.entries()]
    .map(([label, { amount, count }]) => ({ label, amount: round(amount), share: amount / total, count }))
    .sort((a, b) => b.amount - a.amount);
}

/** The months with anything in them, newest first, for a month stepper. */
export function monthsWithActivity(entries: Entry[]): string[] {
  return [...new Set(entries.map((e) => e.booking_date.slice(0, 7)))].sort().reverse();
}
