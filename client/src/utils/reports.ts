/**
 * Statements, as opposed to screens.
 *
 * Everything this app shows is a live view: a figure that moves as the data
 * moves, which is what you want when you are deciding something. It is not
 * what you want when you need to *state* something — to a lender, an
 * accountant, a partner, or yourself in a year. That needs a period, a set of
 * line items that add to a total, and a figure that does not change when you
 * look away from it.
 *
 * So every report here resolves to one shape. A report is columns, sections of
 * rows, and notes saying what is and is not inside it. That is deliberately
 * boring: it means one renderer draws all of them, one exporter writes all of
 * them to CSV, and adding a seventh report is a function rather than a page.
 *
 * Two rules the shape enforces. Every report carries a **period** in words,
 * because a statement without one is a number with no claim attached. And
 * every cell that is money carries the raw figure beside its formatted text,
 * so the export is something a spreadsheet can add up rather than a picture
 * of one.
 */

export type Emphasis = "good" | "bad" | "muted";

export interface ReportCell {
  /** What the screen shows, already formatted. */
  text: string;
  /** The figure behind it, for an export that has to be summable. */
  amount?: number;
  emphasis?: Emphasis;
}

export interface ReportRow {
  label: string;
  /** A second line under the label — an account type, a rate, a count. */
  detail?: string;
  cells: ReportCell[];
  kind?: "subtotal" | "total";
}

export interface ReportSection {
  heading?: string;
  rows: ReportRow[];
  /** Said in place of the rows when there are none, rather than an empty table. */
  empty?: string;
}

export interface Report {
  id: string;
  title: string;
  /** The window it covers, in words. */
  period: string;
  columns: string[];
  sections: ReportSection[];
  /** What the figures include and leave out. Never decoration. */
  notes: string[];
}

/** One line of a statement before it has been formatted. */
export interface LineItem {
  label: string;
  detail?: string;
  /** Positive. Which side of the statement it is on is the caller's business. */
  amount: number;
}

export interface Period {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive. */
  to: string;
  label: string;
}

const money0 = (value: number) => value.toFixed(2);

/** A share as a percentage, or a dash when the base is nothing to divide by. */
export function share(part: number, whole: number): string {
  if (!(Math.abs(whole) > 0)) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function cell(amount: number, money: (value: number) => string, emphasis?: Emphasis): ReportCell {
  return { text: money(amount), amount, emphasis };
}

function text(value: string, emphasis?: Emphasis): ReportCell {
  return { text: value, emphasis };
}

/* ------------------------------------------------------------------ periods */

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthEnd(year: number, monthIndex: number): string {
  return iso(new Date(Date.UTC(year, monthIndex + 1, 0)));
}

/**
 * The windows worth offering, which is not every window imaginable.
 *
 * The current month is offered even though it is unfinished, because
 * "how is this month going" is a real question — but it is labelled as
 * running, so the figure is never mistaken for a closed month's.
 */
export function periodOptions(now = new Date()): Period[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = iso(now);
  const monthName = (y: number, m: number) =>
    new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return [
    { from: iso(new Date(Date.UTC(year, month, 1))), to: today, label: `${monthName(year, month)} (so far)` },
    {
      from: iso(new Date(Date.UTC(year, month - 1, 1))),
      to: monthEnd(year, month - 1),
      label: monthName(year, month - 1),
    },
    { from: iso(new Date(Date.UTC(year, month - 2, 1))), to: today, label: "Last 3 months" },
    { from: `${year}-01-01`, to: today, label: `${year} to date` },
    { from: iso(new Date(Date.UTC(year, month - 11, 1))), to: today, label: "Last 12 months" },
    { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: `${year - 1}` },
    { from: "0001-01-01", to: today, label: "All time" },
  ];
}

/** Whole months the period touches, never less than one — a divisor, so it cannot be zero. */
export function monthsInPeriod(period: Period): number {
  const from = period.from.slice(0, 7);
  const to = period.to.slice(0, 7);
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

export function monthsCovered(period: Period, entries: { booking_date: string }[]): string[] {
  const months = new Set<string>();
  for (const entry of entries) {
    if (entry.booking_date >= period.from && entry.booking_date <= period.to) months.add(entry.booking_date.slice(0, 7));
  }
  return [...months].sort();
}

export function inPeriod<T extends { booking_date: string }>(entries: T[], period: Period): T[] {
  return entries.filter((e) => e.booking_date >= period.from && e.booking_date <= period.to);
}

/* ------------------------------------------------- 1. net worth statement */

export interface NetWorthInput {
  assets: LineItem[];
  liabilities: LineItem[];
  /** Currencies that had no rate, so the total can admit what is missing. */
  unconvertible?: string[];
}

/**
 * What is owned, what is owed, and the difference.
 *
 * The one report that is a snapshot rather than a window: a balance sheet has
 * a date, not a period. Liabilities are listed as positive amounts owed, which
 * is how anybody reads their own card balance, while the net worth line does
 * the subtraction — the sign convention stays where it belongs, in the data.
 */
export function netWorthStatement(
  { assets, liabilities, unconvertible = [] }: NetWorthInput,
  money: (value: number) => string,
  asAt: string
): Report {
  const totalAssets = assets.reduce((sum, a) => sum + a.amount, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);
  const net = totalAssets - totalLiabilities;

  const notes = [
    "Liabilities are shown as amounts owed. Net worth subtracts them.",
    // The lender-grade line, and the reason it is here rather than only on a
    // dashboard tile: a statement that gives assets and debts but not their
    // ratio makes the reader do the division that decides the answer.
    "Debt-to-asset is what is owed as a share of what is owned — under 50% is generally considered healthy.",
  ];
  if (unconvertible.length > 0) {
    notes.push(`Leaves out ${unconvertible.join(", ")} — no exchange rate was available, so nothing was guessed.`);
  }

  return {
    id: "net-worth",
    title: "Net Worth Statement",
    period: `As at ${asAt}`,
    columns: ["Value"],
    sections: [
      {
        heading: "Assets",
        empty: "Nothing recorded as an asset.",
        rows: [
          ...assets.map((a) => ({ label: a.label, detail: a.detail, cells: [cell(a.amount, money)] })),
          { label: "Total assets", cells: [cell(totalAssets, money, "good")], kind: "subtotal" as const },
        ],
      },
      {
        heading: "Liabilities",
        empty: "Nothing owed.",
        rows: [
          ...liabilities.map((l) => ({ label: l.label, detail: l.detail, cells: [cell(l.amount, money)] })),
          { label: "Total liabilities", cells: [cell(totalLiabilities, money, "bad")], kind: "subtotal" as const },
        ],
      },
      {
        rows: [
          { label: "Net worth", cells: [cell(net, money, net >= 0 ? "good" : "bad")], kind: "total" as const },
          {
            label: "Debt-to-asset ratio",
            detail: totalAssets > 0 && totalLiabilities / totalAssets > 0.5 ? "Above half of what is owned" : undefined,
            cells: [text(share(totalLiabilities, totalAssets), totalLiabilities / (totalAssets || 1) > 0.5 ? "bad" : "good")],
          },
        ],
      },
    ],
    notes,
  };
}

/* ------------------------------------------- 2. income & expense statement */

export interface Entry {
  booking_date: string;
  amount: number;
  category_id: number | null;
}

const UNCATEGORISED = "Uncategorised";

function byCategory(entries: Entry[], name: (id: number | null) => string): Map<string, { total: number; count: number }> {
  const totals = new Map<string, { total: number; count: number }>();
  for (const entry of entries) {
    const key = name(entry.category_id) || UNCATEGORISED;
    const current = totals.get(key) ?? { total: 0, count: 0 };
    current.total += Math.abs(entry.amount);
    current.count += 1;
    totals.set(key, current);
  }
  return totals;
}

function sortedRows(
  totals: Map<string, { total: number; count: number }>,
  whole: number,
  money: (value: number) => string
): ReportRow[] {
  return [...totals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([label, { total, count }]) => ({
      label,
      detail: `${count} transaction${count === 1 ? "" : "s"}`,
      cells: [cell(total, money), text(share(total, whole))],
    }));
}

/**
 * What came in, what went out, and what was left — by category.
 *
 * The share column is of *income* on both sides, not of its own side's total.
 * A category that is 40% of spending tells you how you spend; the same
 * category as 22% of what you earned tells you whether you can afford it, and
 * only the second question has an answer that matters.
 */
export function incomeExpenseStatement(
  entries: Entry[],
  period: Period,
  categoryName: (id: number | null) => string,
  money: (value: number) => string
): Report {
  const within = inPeriod(entries, period);
  const income = within.filter((e) => e.amount > 0);
  const expenses = within.filter((e) => e.amount < 0);

  const totalIncome = income.reduce((sum, e) => sum + e.amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const net = totalIncome - totalExpenses;
  const months = monthsCovered(period, within).length || 1;

  return {
    id: "income-expense",
    title: "Income & Expense Statement",
    period: period.label,
    columns: ["Amount", "% of income"],
    sections: [
      {
        heading: "Income",
        empty: "Nothing came in during this period.",
        rows: [
          ...sortedRows(byCategory(income, categoryName), totalIncome, money),
          {
            label: "Total income",
            cells: [cell(totalIncome, money, "good"), text("100.0%")],
            kind: "subtotal" as const,
          },
        ],
      },
      {
        heading: "Expenses",
        empty: "Nothing went out during this period.",
        rows: [
          ...sortedRows(byCategory(expenses, categoryName), totalIncome, money),
          {
            label: "Total expenses",
            cells: [cell(totalExpenses, money, "bad"), text(share(totalExpenses, totalIncome))],
            kind: "subtotal" as const,
          },
        ],
      },
      {
        rows: [
          {
            label: net >= 0 ? "Surplus" : "Shortfall",
            detail: `${money(net / months)} a month across ${months} month${months === 1 ? "" : "s"}`,
            cells: [cell(net, money, net >= 0 ? "good" : "bad"), text(share(net, totalIncome))],
            kind: "total" as const,
          },
        ],
      },
    ],
    notes: [
      "Transfers between your own accounts and loan repayments are left out — money moving from one pocket to another is not income or spending.",
      "Figures are converted to your base currency at today's rate.",
    ],
  };
}

/* -------------------------------------------------- 3. budget vs actual */

export interface BudgetLine {
  category: string;
  /** The cap, per month. */
  monthlyLimit: number;
}

/**
 * Each cap against what was actually spent against it over the period.
 *
 * The cap is multiplied by the months the period covers, which is the only
 * comparison that means anything: a monthly limit of 300 set beside a
 * quarter's spending of 850 reads as a catastrophic overspend and is in fact
 * fifty euro under.
 *
 * Spending with no cap gets a row of its own rather than being left out.
 * A budget report that silently omits the categories nobody budgeted is a
 * report that always balances.
 */
export function budgetVsActual(
  budgets: BudgetLine[],
  spentByCategory: Map<string, number>,
  period: Period,
  money: (value: number) => string
): Report {
  const months = monthsInPeriod(period);
  const budgeted = new Set(budgets.map((b) => b.category));

  const rows: ReportRow[] = budgets
    .map((b) => {
      const allowed = b.monthlyLimit * months;
      const actual = spentByCategory.get(b.category) ?? 0;
      const variance = allowed - actual;
      return {
        label: b.category,
        detail: months > 1 ? `${money(b.monthlyLimit)}/mo × ${months}` : undefined,
        cells: [
          cell(allowed, money),
          cell(actual, money),
          cell(variance, money, variance >= 0 ? "good" : "bad"),
          text(share(actual, allowed), actual > allowed ? "bad" : undefined),
        ],
      };
    })
    .sort((a, b) => (b.cells[1].amount ?? 0) - (a.cells[1].amount ?? 0));

  const unbudgeted = [...spentByCategory.entries()]
    .filter(([category]) => !budgeted.has(category))
    .sort((a, b) => b[1] - a[1]);
  const unbudgetedTotal = unbudgeted.reduce((sum, [, amount]) => sum + amount, 0);

  const totalAllowed = budgets.reduce((sum, b) => sum + b.monthlyLimit * months, 0);
  // Deliberately only the categories that have a limit. Measuring every euro
  // of spending against the sum of the limits is how a budget report ends up
  // reading "395% used" for a household whose two budgets are both roughly
  // kept — the figure is arithmetic and the claim it makes is false.
  const budgetedActual = budgets.reduce((sum, b) => sum + (spentByCategory.get(b.category) ?? 0), 0);
  const budgetedVariance = totalAllowed - budgetedActual;
  const totalActual = [...spentByCategory.values()].reduce((sum, amount) => sum + amount, 0);
  const dash = () => text("—", "muted");

  return {
    id: "budget-vs-actual",
    title: "Budget vs Actual",
    period: period.label,
    columns: ["Budget", "Actual", "Variance", "Used"],
    sections: [
      {
        heading: "Budgeted",
        empty: "No budgets set.",
        rows: [
          ...rows,
          {
            label: "Budgeted total",
            cells: [
              cell(totalAllowed, money),
              cell(budgetedActual, money),
              cell(budgetedVariance, money, budgetedVariance >= 0 ? "good" : "bad"),
              text(share(budgetedActual, totalAllowed), budgetedActual > totalAllowed ? "bad" : undefined),
            ],
            kind: "subtotal" as const,
          },
        ],
      },
      {
        heading: "Not budgeted",
        empty: "Every category with spending in it has a limit.",
        rows:
          unbudgeted.length === 0
            ? []
            : [
                ...unbudgeted.map((entry) => ({
                  label: entry[0],
                  cells: [dash(), cell(entry[1], money), dash(), dash()],
                })),
                {
                  label: "Against no limit",
                  cells: [dash(), cell(unbudgetedTotal, money), dash(), dash()],
                  kind: "subtotal" as const,
                },
              ],
      },
      {
        rows: [
          {
            // One column summed, and nothing compared. A total that silently
            // widened what "Used" was measuring would be the original fault
            // in a different row.
            label: "All spending",
            detail:
              unbudgetedTotal > 0
                ? `${share(unbudgetedTotal, totalActual)} of it in categories with no limit`
                : "Every euro of it against a limit",
            cells: [dash(), cell(totalActual, money), dash(), dash()],
            kind: "total" as const,
          },
        ],
      },
    ],
    notes: [
      months > 1
        ? `Each limit is a monthly one, multiplied by the ${months} months this period covers.`
        : "Each limit is a monthly one.",
      "A positive variance is money not spent.",
      "The budgeted total compares only the categories that have a limit. Spending with no limit is listed and summed, but measuring it against caps that were never set would make every household look wildly over.",
    ],
  };
}

/* ---------------------------------------------------- 4. annual summary */

/**
 * Twelve rows, one per month, and the year underneath them.
 *
 * The savings rate per month is the column that earns this report. A year's
 * total hides the shape: two households both saving 18% over a year, one
 * steadily and one by saving a third for nine months and spending the rest,
 * are in completely different positions, and only the month rows show it.
 */
export function annualSummary(entries: Entry[], period: Period, money: (value: number) => string): Report {
  const within = inPeriod(entries, period);
  const months = monthsCovered(period, within);

  const byMonth = new Map<string, { income: number; expenses: number }>();
  for (const month of months) byMonth.set(month, { income: 0, expenses: 0 });
  for (const entry of within) {
    const bucket = byMonth.get(entry.booking_date.slice(0, 7));
    if (!bucket) continue;
    if (entry.amount > 0) bucket.income += entry.amount;
    else bucket.expenses += Math.abs(entry.amount);
  }

  const rows: ReportRow[] = months.map((month) => {
    const { income, expenses } = byMonth.get(month)!;
    const net = income - expenses;
    return {
      label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      cells: [
        cell(income, money),
        cell(expenses, money),
        cell(net, money, net >= 0 ? "good" : "bad"),
        text(share(net, income), net < 0 ? "bad" : undefined),
      ],
    };
  });

  const totalIncome = [...byMonth.values()].reduce((sum, m) => sum + m.income, 0);
  const totalExpenses = [...byMonth.values()].reduce((sum, m) => sum + m.expenses, 0);
  const net = totalIncome - totalExpenses;

  const notes: string[] = [];
  if (months.length > 1) {
    const best = [...byMonth.entries()].reduce((a, b) => (b[1].income - b[1].expenses > a[1].income - a[1].expenses ? b : a));
    const worst = [...byMonth.entries()].reduce((a, b) => (b[1].income - b[1].expenses < a[1].income - a[1].expenses ? b : a));
    const name = (m: string) =>
      new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
    notes.push(
      `Best month ${name(best[0])} at ${money(best[1].income - best[1].expenses)}; worst ${name(worst[0])} at ${money(
        worst[1].income - worst[1].expenses
      )}.`
    );
  }
  notes.push("Only months with something in them appear — a gap is a month with no recorded transactions, not a month of zero.");

  return {
    id: "annual-summary",
    title: "Month-by-Month Summary",
    period: period.label,
    columns: ["Income", "Expenses", "Net", "Saved"],
    sections: [
      { heading: undefined, empty: "No transactions in this period.", rows },
      {
        rows: [
          {
            label: "Total",
            detail: months.length > 0 ? `Averaging ${money(net / months.length)} a month` : undefined,
            cells: [
              cell(totalIncome, money, "good"),
              cell(totalExpenses, money, "bad"),
              cell(net, money, net >= 0 ? "good" : "bad"),
              text(share(net, totalIncome)),
            ],
            kind: "total" as const,
          },
        ],
      },
    ],
    notes,
  };
}

/* ------------------------------------------------------- 5. key ratios */

export interface RatioInput {
  totalAssets: number;
  totalLiabilities: number;
  /** Per month, averaged across the period. */
  monthlyIncome: number;
  monthlyExpenses: number;
  /** Minimum or contractual payments on everything owed, per month. */
  monthlyDebtPayments: number;
  /** What could be reached this week: cash and savings, not the house. */
  liquidAssets: number;
  investments: number;
}

/**
 * The ratios a lender, a planner or a worried person actually asks for.
 *
 * Each one is a division anybody could do from the figures above it, and that
 * is the point: they are here so the division is done the same way every time
 * and said in the same words, rather than recomputed by whoever is asking.
 *
 * Every rate of thumb quoted is named as a rule of thumb. None of them is
 * advice about this household, and a report that implied otherwise would be
 * pretending to know things it does not.
 */
export function keyRatios(input: RatioInput, money: (value: number) => string): Report {
  const { totalAssets, totalLiabilities, monthlyIncome, monthlyExpenses, monthlyDebtPayments, liquidAssets, investments } =
    input;

  const netWorth = totalAssets - totalLiabilities;
  const cashFlow = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? cashFlow / monthlyIncome : 0;
  const dti = monthlyIncome > 0 ? monthlyDebtPayments / monthlyIncome : 0;
  const runway = monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : null;

  const months = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} months`);

  return {
    id: "key-ratios",
    title: "Financial Health",
    period: "Current position, against the last 12 months",
    columns: ["Value"],
    sections: [
      {
        heading: "Position",
        rows: [
          { label: "Net worth", cells: [cell(netWorth, money, netWorth >= 0 ? "good" : "bad")], kind: "subtotal" },
          { label: "Total assets", cells: [cell(totalAssets, money)] },
          { label: "Total debt", cells: [cell(totalLiabilities, money)] },
          { label: "Investment portfolio", cells: [cell(investments, money)] },
          { label: "Liquid assets", detail: "Cash and savings — what is reachable this week", cells: [cell(liquidAssets, money)] },
        ],
      },
      {
        heading: "Flow",
        rows: [
          { label: "Monthly income", cells: [cell(monthlyIncome, money)] },
          { label: "Monthly expenses", cells: [cell(monthlyExpenses, money)] },
          { label: "Monthly cash flow", cells: [cell(cashFlow, money, cashFlow >= 0 ? "good" : "bad")], kind: "subtotal" },
          { label: "Monthly debt payments", cells: [cell(monthlyDebtPayments, money)] },
          {
            label: "Net after debt payments",
            detail: "What is left once everything owed has been serviced",
            cells: [
              cell(cashFlow - monthlyDebtPayments, money, cashFlow - monthlyDebtPayments >= 0 ? "good" : "bad"),
            ],
          },
          { label: "Annual income", cells: [cell(monthlyIncome * 12, money)] },
          { label: "Annual expenses", cells: [cell(monthlyExpenses * 12, money)] },
        ],
      },
      {
        heading: "Ratios",
        rows: [
          {
            label: "Savings rate",
            detail: "Rule of thumb: 20% or better",
            cells: [text(share(cashFlow, monthlyIncome), savingsRate >= 0.2 ? "good" : savingsRate < 0 ? "bad" : undefined)],
          },
          {
            label: "Debt-to-income",
            detail: "Payments as a share of income. Lenders generally want under 36%",
            cells: [text(share(monthlyDebtPayments, monthlyIncome), dti > 0.36 ? "bad" : "good")],
          },
          {
            label: "Debt-to-asset",
            detail: "What is owed against what is owned",
            cells: [
              text(share(totalLiabilities, totalAssets), totalAssets > 0 && totalLiabilities / totalAssets > 0.5 ? "bad" : "good"),
            ],
          },
          {
            label: "Cash runway",
            detail: "How long the liquid assets cover the outgoings with nothing coming in",
            cells: [text(months(runway), runway !== null && runway < 3 ? "bad" : runway !== null && runway >= 6 ? "good" : undefined)],
          },
        ],
      },
    ],
    notes: [
      "Monthly figures are averages across the last 12 months of recorded transactions, not this month alone.",
      "The thresholds quoted are common rules of thumb, not advice about your situation.",
    ],
  };
}

/* ------------------------------------------------------------- exporting */

/**
 * A report as a spreadsheet.
 *
 * Headings become rows of their own rather than being dropped, so the
 * structure survives the trip — a flat list of line items with no "Assets" and
 * "Liabilities" above them is a list that cannot be read.
 */
export function reportToCsv(report: Report): { headers: string[]; rows: unknown[][] } {
  const headers = ["Section", "Item", "Detail", ...report.columns];
  const rows: unknown[][] = [];

  for (const section of report.sections) {
    for (const row of section.rows) {
      rows.push([
        section.heading ?? "",
        row.label,
        row.detail ?? "",
        // The raw number where there is one, so the column adds up; the text
        // where there isn't, because a percentage is not a figure to sum.
        ...row.cells.map((c) => (c.amount === undefined ? c.text : money0(c.amount))),
      ]);
    }
  }

  return { headers, rows };
}
