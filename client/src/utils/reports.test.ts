import { describe, expect, it } from "vitest";
import {
  annualSummary,
  budgetVsActual,
  incomeExpenseStatement,
  inPeriod,
  keyRatios,
  monthsInPeriod,
  netWorthStatement,
  periodOptions,
  reportToCsv,
  share,
  type Period,
  type Report,
} from "./reports.js";

const money = (value: number) => `€${value.toFixed(2)}`;

/** The figure in the one-column reports, or the named column elsewhere. */
function row(report: Report, label: string) {
  for (const section of report.sections) {
    const found = section.rows.find((r) => r.label === label);
    if (found) return found;
  }
  throw new Error(`no row "${label}" in ${report.id}`);
}

describe("share", () => {
  it("is a percentage to one place", () => {
    expect(share(52.6, 100)).toBe("52.6%");
    expect(share(576800, 1097213)).toBe("52.6%");
  });

  // Dividing by nothing is not zero per cent, it is an unanswerable question,
  // and "0.0%" would be a confident wrong answer.
  it("refuses to divide by nothing", () => {
    expect(share(100, 0)).toBe("—");
  });

  it("handles a negative part", () => {
    expect(share(-250, 1000)).toBe("-25.0%");
  });
});

describe("periods", () => {
  it("offers a window for each question somebody actually asks", () => {
    const labels = periodOptions(new Date("2026-11-16T00:00:00Z")).map((p) => p.label);
    expect(labels).toContain("Last 12 months");
    expect(labels).toContain("2026 to date");
    expect(labels).toContain("2025");
    expect(labels).toContain("All time");
  });

  // Unfinished, and said so — the figure is right, the period is just open.
  it("marks the running month as running", () => {
    const [current] = periodOptions(new Date("2026-11-16T00:00:00Z"));
    expect(current.label).toContain("so far");
    expect(current.from).toBe("2026-11-01");
    expect(current.to).toBe("2026-11-16");
  });

  it("closes last month on its own last day", () => {
    const [, last] = periodOptions(new Date("2026-03-09T00:00:00Z"));
    expect(last.from).toBe("2026-02-01");
    expect(last.to).toBe("2026-02-28");
  });

  it("counts the months a period touches, never fewer than one", () => {
    expect(monthsInPeriod({ from: "2026-01-01", to: "2026-03-31", label: "" })).toBe(3);
    expect(monthsInPeriod({ from: "2026-11-01", to: "2026-11-16", label: "" })).toBe(1);
    expect(monthsInPeriod({ from: "2025-12-01", to: "2026-02-28", label: "" })).toBe(3);
  });

  it("keeps both ends of the window", () => {
    const period = { from: "2026-02-01", to: "2026-02-28", label: "" };
    const kept = inPeriod(
      [{ booking_date: "2026-01-31" }, { booking_date: "2026-02-01" }, { booking_date: "2026-02-28" }, { booking_date: "2026-03-01" }],
      period
    );
    expect(kept.map((k) => k.booking_date)).toEqual(["2026-02-01", "2026-02-28"]);
  });
});

describe("netWorthStatement", () => {
  const input = {
    assets: [
      { label: "Primary Checking", detail: "Cash", amount: 18500 },
      { label: "High Yield Savings", detail: "Cash", amount: 42000 },
      { label: "742 Evergreen Terrace", detail: "Real estate", amount: 520000 },
    ],
    liabilities: [
      { label: "742 Evergreen Terrace Mortgage", detail: "Mortgage", amount: 298000 },
      { label: "Chase Sapphire", detail: "Credit card", amount: 3200 },
    ],
  };

  it("adds each side and subtracts one from the other", () => {
    const report = netWorthStatement(input, money, "16 November 2026");
    expect(row(report, "Total assets").cells[0].amount).toBe(580500);
    expect(row(report, "Total liabilities").cells[0].amount).toBe(301200);
    expect(row(report, "Net worth").cells[0].amount).toBe(279300);
  });

  /**
   * A balance sheet has a date, not a period, and a statement with neither is
   * a number with no claim attached.
   */
  it("is dated rather than given a window", () => {
    expect(netWorthStatement(input, money, "16 November 2026").period).toBe("As at 16 November 2026");
  });

  it("does the ratio the reader would otherwise have to do themselves", () => {
    expect(row(netWorthStatement(input, money, "today"), "Debt-to-asset ratio").cells[0].text).toBe("51.9%");
  });

  it("flags a net worth in the red rather than only printing it", () => {
    const upsideDown = netWorthStatement(
      { assets: [{ label: "Current", amount: 500 }], liabilities: [{ label: "Card", amount: 3000 }] },
      money,
      "today"
    );
    expect(row(upsideDown, "Net worth").cells[0].amount).toBe(-2500);
    expect(row(upsideDown, "Net worth").cells[0].emphasis).toBe("bad");
  });

  // A total presented as complete while part of it was dropped is the one
  // failure mode worse than showing nothing.
  it("says what it had to leave out", () => {
    const report = netWorthStatement({ ...input, unconvertible: ["ZAR"] }, money, "today");
    expect(report.notes.join(" ")).toContain("ZAR");
  });

  it("says so rather than showing an empty table", () => {
    const empty = netWorthStatement({ assets: [], liabilities: [] }, money, "today");
    expect(empty.sections[0].empty).toBeTruthy();
    expect(row(empty, "Net worth").cells[0].amount).toBe(0);
  });
});

describe("incomeExpenseStatement", () => {
  const period: Period = { from: "2026-01-01", to: "2026-03-31", label: "Q1 2026" };
  const name = (id: number | null) => ({ 1: "Salary", 2: "Groceries", 3: "Takeaway" })[id as 1 | 2 | 3] ?? "";
  const entries = [
    { booking_date: "2026-01-05", amount: 4000, category_id: 1 },
    { booking_date: "2026-02-05", amount: 4000, category_id: 1 },
    { booking_date: "2026-03-05", amount: 4000, category_id: 1 },
    { booking_date: "2026-01-10", amount: -600, category_id: 2 },
    { booking_date: "2026-02-10", amount: -700, category_id: 2 },
    { booking_date: "2026-03-10", amount: -220, category_id: 3 },
    // Outside the window, and must not be counted.
    { booking_date: "2025-12-31", amount: -5000, category_id: 2 },
  ];

  it("separates what came in from what went out", () => {
    const report = incomeExpenseStatement(entries, period, name, money);
    expect(row(report, "Total income").cells[0].amount).toBe(12000);
    expect(row(report, "Total expenses").cells[0].amount).toBe(1520);
    expect(row(report, "Surplus").cells[0].amount).toBe(10480);
  });

  it("ignores everything outside the period", () => {
    const report = incomeExpenseStatement(entries, period, name, money);
    expect(row(report, "Groceries").cells[0].amount).toBe(1300);
  });

  /**
   * Both sides are shown against income, not against their own side's total.
   * "40% of spending" tells you how you spend; "11% of what you earned" tells
   * you whether you can afford it.
   */
  it("measures spending against income, not against spending", () => {
    const report = incomeExpenseStatement(entries, period, name, money);
    expect(row(report, "Groceries").cells[1].text).toBe("10.8%");
  });

  it("names a shortfall a shortfall", () => {
    const report = incomeExpenseStatement(
      [
        { booking_date: "2026-01-05", amount: 1000, category_id: 1 },
        { booking_date: "2026-01-06", amount: -1500, category_id: 2 },
      ],
      period,
      name,
      money
    );
    expect(row(report, "Shortfall").cells[0].amount).toBe(-500);
  });

  it("files a transaction with no category rather than dropping it", () => {
    const report = incomeExpenseStatement([{ booking_date: "2026-01-04", amount: -80, category_id: null }], period, name, money);
    expect(row(report, "Uncategorised").cells[0].amount).toBe(80);
  });

  it("puts the biggest first, which is the order anybody reads it in", () => {
    const report = incomeExpenseStatement(entries, period, name, money);
    const expenses = report.sections[1].rows.filter((r) => !r.kind).map((r) => r.label);
    expect(expenses).toEqual(["Groceries", "Takeaway"]);
  });
});

describe("budgetVsActual", () => {
  const quarter: Period = { from: "2026-01-01", to: "2026-03-31", label: "Q1 2026" };

  /**
   * The comparison this report exists to get right. A monthly limit of 300
   * beside a quarter's spending of 850 reads as a disaster and is in fact
   * fifty under.
   */
  it("multiplies a monthly cap by the months the period covers", () => {
    const report = budgetVsActual([{ category: "Groceries", monthlyLimit: 300 }], new Map([["Groceries", 850]]), quarter, money);
    const groceries = row(report, "Groceries");
    expect(groceries.cells[0].amount).toBe(900);
    expect(groceries.cells[1].amount).toBe(850);
    expect(groceries.cells[2].amount).toBe(50);
    expect(groceries.cells[2].emphasis).toBe("good");
  });

  it("marks an overspend against the right side", () => {
    const month: Period = { from: "2026-03-01", to: "2026-03-31", label: "March" };
    const report = budgetVsActual([{ category: "Takeaway", monthlyLimit: 50 }], new Map([["Takeaway", 222]]), month, money);
    expect(row(report, "Takeaway").cells[2].amount).toBe(-172);
    expect(row(report, "Takeaway").cells[2].emphasis).toBe("bad");
    expect(row(report, "Takeaway").cells[3].text).toBe("444.0%");
  });

  /**
   * A budget report that silently omits the categories nobody budgeted is a
   * report that always balances.
   */
  it("gives spending with no cap a row of its own", () => {
    const report = budgetVsActual(
      [{ category: "Groceries", monthlyLimit: 300 }],
      new Map([
        ["Groceries", 280],
        ["Gifts", 140],
      ]),
      { from: "2026-03-01", to: "2026-03-31", label: "March" },
      money
    );
    expect(row(report, "Gifts").cells[1].amount).toBe(140);
    expect(row(report, "Gifts").cells[0].text).toBe("—");
    expect(row(report, "Against no limit").cells[1].amount).toBe(140);
    expect(row(report, "All spending").cells[1].amount).toBe(420);
  });

  /**
   * The fault this split exists to prevent. Measuring every euro against the
   * sum of the limits made two roughly-kept budgets report "395% used" — the
   * arithmetic was right and the claim it made was false.
   */
  it("compares only the categories that have a limit", () => {
    const report = budgetVsActual(
      [{ category: "Groceries", monthlyLimit: 500 }],
      new Map([
        ["Groceries", 480],
        ["Rent", 1450],
      ]),
      { from: "2026-03-01", to: "2026-03-31", label: "March" },
      money
    );
    const budgeted = row(report, "Budgeted total");
    expect(budgeted.cells[1].amount).toBe(480);
    expect(budgeted.cells[2].amount).toBe(20);
    expect(budgeted.cells[3].text).toBe("96.0%");
    // And the row that sums everything compares nothing, so it cannot
    // reintroduce the same overstatement one row further down.
    const all = row(report, "All spending");
    expect(all.cells[0].text).toBe("—");
    expect(all.cells[3].text).toBe("—");
    expect(all.detail).toContain("no limit");
  });

  it("says plainly when every spending category has a limit", () => {
    const report = budgetVsActual(
      [{ category: "Groceries", monthlyLimit: 300 }],
      new Map([["Groceries", 280]]),
      quarter,
      money
    );
    expect(report.sections[1].rows).toHaveLength(0);
    expect(report.sections[1].empty).toBeTruthy();
    expect(row(report, "All spending").detail).toContain("Every euro");
  });
});

describe("annualSummary", () => {
  const year: Period = { from: "2026-01-01", to: "2026-12-31", label: "2026" };
  const entries = [
    { booking_date: "2026-01-05", amount: 3000, category_id: 1 },
    { booking_date: "2026-01-20", amount: -2000, category_id: 2 },
    { booking_date: "2026-02-05", amount: 3000, category_id: 1 },
    { booking_date: "2026-02-20", amount: -3500, category_id: 2 },
  ];

  it("gives a row per month and a year underneath", () => {
    const report = annualSummary(entries, year, money);
    expect(report.sections[0].rows).toHaveLength(2);
    expect(row(report, "Total").cells[0].amount).toBe(6000);
    expect(row(report, "Total").cells[1].amount).toBe(5500);
    expect(row(report, "Total").cells[2].amount).toBe(500);
  });

  /**
   * The column that earns the report. Two households saving the same over a
   * year, one steadily and one in bursts, are in different positions, and
   * only the month rows show it.
   */
  it("shows each month saving or overspending on its own", () => {
    const report = annualSummary(entries, year, money);
    const [january, february] = report.sections[0].rows;
    expect(january.cells[2].amount).toBe(1000);
    expect(january.cells[3].text).toBe("33.3%");
    expect(february.cells[2].amount).toBe(-500);
    expect(february.cells[2].emphasis).toBe("bad");
  });

  it("names the best and worst month", () => {
    const notes = annualSummary(entries, year, money).notes.join(" ");
    expect(notes).toContain("January");
    expect(notes).toContain("February");
  });

  // A month with no transactions is a month nobody recorded, which is not the
  // same claim as a month where nothing happened.
  it("leaves out months with nothing in them rather than showing zeroes", () => {
    const report = annualSummary([{ booking_date: "2026-07-01", amount: 100, category_id: null }], year, money);
    expect(report.sections[0].rows).toHaveLength(1);
    expect(report.notes.join(" ")).toContain("not a month of zero");
  });
});

describe("keyRatios", () => {
  // The worked example from a competitor's own screenshot, which is a useful
  // check precisely because the arithmetic is somebody else's.
  const input = {
    totalAssets: 1097213,
    totalLiabilities: 576800,
    monthlyIncome: 10670,
    monthlyExpenses: 4239,
    monthlyDebtPayments: 4730,
    liquidAssets: 85000,
    investments: 111713,
  };

  it("works the position out the way anybody checking it would", () => {
    const report = keyRatios(input, money);
    expect(row(report, "Net worth").cells[0].amount).toBe(520413);
    expect(row(report, "Monthly cash flow").cells[0].amount).toBe(6431);
    expect(row(report, "Net after debt payments").cells[0].amount).toBe(1701);
    expect(row(report, "Annual expenses").cells[0].amount).toBe(50868);
  });

  it("gives the three ratios a lender asks for", () => {
    const report = keyRatios(input, money);
    expect(row(report, "Savings rate").cells[0].text).toBe("60.3%");
    expect(row(report, "Debt-to-income").cells[0].text).toBe("44.3%");
    expect(row(report, "Debt-to-asset").cells[0].text).toBe("52.6%");
  });

  it("flags the ones outside the usual thresholds", () => {
    const report = keyRatios(input, money);
    expect(row(report, "Debt-to-income").cells[0].emphasis).toBe("bad");
    expect(row(report, "Savings rate").cells[0].emphasis).toBe("good");
  });

  it("states runway in months, and worries below three", () => {
    expect(row(keyRatios(input, money), "Cash runway").cells[0].text).toBe("20.1 months");
    const thin = keyRatios({ ...input, liquidAssets: 4000 }, money);
    expect(row(thin, "Cash runway").cells[0].emphasis).toBe("bad");
  });

  // Dividing by an income of nothing is unanswerable, not zero.
  it("does not invent a ratio out of no income", () => {
    const report = keyRatios({ ...input, monthlyIncome: 0 }, money);
    expect(row(report, "Savings rate").cells[0].text).toBe("—");
    expect(row(report, "Debt-to-income").cells[0].text).toBe("—");
  });

  /**
   * The thresholds are rules of thumb and are named as such. A report that
   * implied they were advice about this household would be pretending to know
   * something it does not.
   */
  it("says its thresholds are rules of thumb", () => {
    expect(keyRatios(input, money).notes.join(" ")).toContain("rules of thumb");
  });
});

describe("reportToCsv", () => {
  const report = netWorthStatement(
    {
      assets: [{ label: "Current", detail: "Cash", amount: 1000 }],
      liabilities: [{ label: "Card", detail: "Credit card", amount: 400 }],
    },
    money,
    "today"
  );

  /**
   * The headings become columns rather than being dropped: a flat list of line
   * items with no "Assets" and "Liabilities" above them cannot be read.
   */
  it("keeps the structure so the file can be read", () => {
    const { headers, rows } = reportToCsv(report);
    expect(headers).toEqual(["Section", "Item", "Detail", "Value"]);
    expect(rows[0]).toEqual(["Assets", "Current", "Cash", "1000.00"]);
    expect(rows.find((r) => r[1] === "Net worth")).toEqual(["", "Net worth", "", "600.00"]);
  });

  // A column of "€1,000.00" sums to zero in a spreadsheet without saying so.
  it("exports figures a spreadsheet can add up", () => {
    const { rows } = reportToCsv(report);
    for (const value of rows.map((r) => r[3])) {
      if (String(value).endsWith("%")) continue;
      expect(String(value)).toMatch(/^-?\d+\.\d\d$/);
    }
  });

  it("leaves a percentage as text, because it is not a figure to sum", () => {
    const { rows } = reportToCsv(report);
    expect(rows.find((r) => r[1] === "Debt-to-asset ratio")?.[3]).toBe("40.0%");
  });
});
