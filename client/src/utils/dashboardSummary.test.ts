import { describe, expect, it } from "vitest";
import { dailySpend, incomeBySource, monthsWithActivity, summaryFigures, type Entry } from "./dashboardSummary.js";

const tx = (booking_date: string, amount: number, category_id: number | null = null): Entry => ({
  booking_date,
  amount,
  category_id,
});

/**
 * Income is the declared thing, not the positive thing: 1 and 2 are the
 * categories marked as income, and nothing else counts however it is signed.
 */
const kind = (id: number | null) =>
  id == null ? null : { countsAsIncome: id === 1 || id === 2, isTransfer: id === 9 };

const month = "2026-11";
const entries: Entry[] = [
  tx("2026-11-01", 4200, 1),
  tx("2026-11-15", 800, 2),
  tx("2026-11-03", -1450, 3),
  tx("2026-11-03", -62, 4),
  tx("2026-11-17", -230, 4),
  // Another month entirely, which must stay out of every figure below.
  tx("2026-10-05", 9999, 1),
  tx("2026-10-06", -9999, 3),
];

describe("summaryFigures", () => {
  const figures = summaryFigures({ entries, kind, month, budgeted: 2500, debt: 9400, saved: 4800 });
  const figure = (key: string) => figures.find((f) => f.key === key)!;

  it("totals the month's income and spending separately", () => {
    expect(figure("income").amount).toBe(5000);
    expect(figure("spent").amount).toBe(1742);
  });

  /**
   * A refund is not income, and it is not a separate inflow either — it is
   * money coming back to the thing it was spent on. €120 back on a category
   * that spent €292 means that category cost €172, which is what happened.
   *
   * The tile used to add the €120 to income, which is how a household came to
   * be reported as earning money from its own refunds.
   */
  it("takes a refund off the category it came back to, not onto income", () => {
    const withRefund = summaryFigures({
      entries: [...entries, tx("2026-11-20", 120, 4)],
      kind,
      month,
      budgeted: 0,
      debt: 0,
      saved: 0,
    });
    expect(withRefund.find((f) => f.key === "spent")!.amount).toBe(1622);
    expect(withRefund.find((f) => f.key === "income")!.amount).toBe(5000);
    // And what was left over is unchanged by where the €120 was counted,
    // which is the one figure a reader can check against their bank.
    expect(withRefund.find((f) => f.key === "left")!.amount).toBe(3378);
  });

  /**
   * A credit nobody has filed is not netted against unrelated unfiled
   * spending — that would invent the connection — so it is reported as its
   * own figure under a heading that claims nothing.
   */
  it("gives an unfiled credit its own tile rather than calling it income", () => {
    const withUnfiled = summaryFigures({
      entries: [...entries, tx("2026-11-20", 75)],
      kind,
      month,
      budgeted: 0,
      debt: 0,
      saved: 0,
    });
    expect(withUnfiled.find((f) => f.key === "income")!.amount).toBe(5000);
    expect(withUnfiled.find((f) => f.key === "otherIn")!.amount).toBe(75);
  });

  // Nothing to say when there is nothing uncounted: the tile only appears
  // where money arrived that nothing calls income.
  it("has no other-in tile when every credit is declared income", () => {
    expect(figures.some((f) => f.key === "otherIn")).toBe(false);
  });

  /**
   * Nothing marked is a setup state, not a month that earned nothing. An
   * "Income €0.00" tile over a month with a salary in it would be a plain lie,
   * so the figure is reported under a heading that does not claim earnings.
   */
  it("reports what arrived when no category is marked as income", () => {
    const unset = summaryFigures({
      entries,
      kind: () => ({ countsAsIncome: false, isTransfer: false }),
      anyIncomeCategory: false,
      month,
      budgeted: 0,
      debt: 0,
      saved: 0,
    });
    const first = unset.find((f) => f.key === "income")!;
    expect(first.label).toBe("Money in");
    expect(first.amount).toBe(5000);
    expect(unset.some((f) => f.key === "otherIn")).toBe(false);
  });

  it("ignores every other month", () => {
    expect(figure("income").amount).not.toBeGreaterThan(9000);
  });

  it("names a shortfall rather than printing a negative left-over", () => {
    const tight = summaryFigures({ entries: [tx("2026-11-01", 1000), tx("2026-11-02", -1600)], kind, month, budgeted: 0, debt: 0, saved: 0 });
    const left = tight.find((f) => f.key === "left")!;
    expect(left.label).toBe("Short by");
    expect(left.amount).toBe(600);
    expect(left.tone).toBe("bad");
  });

  /**
   * The thing that makes a strip of identical pills misleading. Income and
   * spending are flows, debt and savings are stocks, a budget is a decision
   * about a month that has not finished. Three kinds, not one.
   */
  it("says which period each figure describes", () => {
    expect(figure("income").basis).toBe("month");
    expect(figure("spent").basis).toBe("month");
    expect(figure("debt").basis).toBe("now");
    expect(figure("saved").basis).toBe("now");
    expect(figure("budgeted").basis).toBe("plan");
  });

  // Against income rather than against the budget: a budget may cover only
  // some categories, and a share of a partial total means nothing.
  it("measures spending against what came in", () => {
    expect(figure("spent").detail).toContain("35% of what came in");
  });

  it("has nothing to compare against on a month with no income", () => {
    const noIncome = summaryFigures({ entries: [tx("2026-11-02", -50)], kind, month, budgeted: 0, debt: 0, saved: 0 });
    expect(noIncome.find((f) => f.key === "spent")!.detail).toBeNull();
  });

  it("says when nothing has been capped", () => {
    const uncapped = summaryFigures({ entries, kind, month, budgeted: 0, debt: 0, saved: 0 });
    expect(uncapped.find((f) => f.key === "budgeted")!.detail).toBe("nothing capped");
  });
});

describe("dailySpend", () => {
  /**
   * Zero days are the point. A line drawn only through the days with
   * something on them rises smoothly and hides the real shape of a month,
   * which is three or four heavy days and a lot of nothing.
   */
  it("gives every day of the month so far, quiet ones included", () => {
    const points = dailySpend(entries, month, new Date("2026-11-18T12:00:00Z"));
    expect(points).toHaveLength(18);
    expect(points[1]).toEqual({ date: "2026-11-02", amount: 0, cumulative: 0 });
    expect(points[2]).toEqual({ date: "2026-11-03", amount: 1512, cumulative: 1512 });
  });

  it("accumulates across the month", () => {
    const points = dailySpend(entries, month, new Date("2026-11-18T12:00:00Z"));
    expect(points[points.length - 1].cumulative).toBe(1742);
  });

  /**
   * A month being lived in stops at today. Drawing the rest of it as zero
   * reads as a sudden stop in spending rather than as a month that has not
   * happened yet.
   */
  it("stops at today in the month being lived in", () => {
    expect(dailySpend(entries, month, new Date("2026-11-05T12:00:00Z"))).toHaveLength(5);
  });

  it("runs to the end of a month already finished", () => {
    expect(dailySpend(entries, "2026-10", new Date("2026-11-18T12:00:00Z"))).toHaveLength(31);
  });

  it("knows how long February is", () => {
    expect(dailySpend([], "2026-02", new Date("2026-11-18T12:00:00Z"))).toHaveLength(28);
    expect(dailySpend([], "2028-02", new Date("2029-01-01T12:00:00Z"))).toHaveLength(29);
  });

  it("counts only money going out", () => {
    const points = dailySpend([tx("2026-11-01", 4200), tx("2026-11-01", -100)], month, new Date("2026-11-02T12:00:00Z"));
    expect(points[0].amount).toBe(100);
  });

  it("returns nothing for a month it cannot read", () => {
    expect(dailySpend(entries, "not-a-month")).toEqual([]);
  });
});

describe("incomeBySource", () => {
  const name = (id: number | null) => ({ 1: "Salary", 2: "Freelance" })[id as 1 | 2] ?? "";
  // Income is the declared thing, not the positive thing: 1 and 2 are the
  // categories marked as income, and nothing else counts however it is signed.
  const isIncome = (id: number | null) => id === 1 || id === 2;

  it("groups the month's income and shares it out", () => {
    const sources = incomeBySource(entries, month, name, isIncome);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ label: "Salary", amount: 4200, share: 0.84, count: 1 });
    expect(sources[1].label).toBe("Freelance");
  });

  /**
   * By category rather than by payer: two payslips from one employer are one
   * source, and a bank reference number would otherwise split them in two.
   */
  it("treats repeat payments from one source as one source", () => {
    const twice = incomeBySource([tx("2026-11-01", 2100, 1), tx("2026-11-15", 2100, 1)], month, name, isIncome);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ amount: 4200, count: 2, share: 1 });
  });

  /**
   * The correction. Every credit used to count, which put refunds, reimbursed
   * expenses and returned payments on a card headed "where income came from".
   * A household does not earn money from its own bus fares, and the only
   * thing that knows the difference is the category's own flag.
   */
  it("leaves out a credit in a category that is not income", () => {
    expect(incomeBySource([tx("2026-11-01", 4200, 1), tx("2026-11-02", 40, 3)], month, name, isIncome)).toEqual([
      { label: "Salary", amount: 4200, share: 1, count: 1 },
    ]);
  });

  // Not filed is not declared. A credit nobody has categorised has not been
  // called income by anyone, so the card does not call it income either.
  it("leaves out a credit with no category at all", () => {
    expect(incomeBySource([tx("2026-11-01", 500, null)], month, name, isIncome)).toEqual([]);
  });

  // A source of nothing is not a source.
  it("says nothing at all on a month with no income", () => {
    expect(incomeBySource([tx("2026-11-01", -500, 3)], month, name, isIncome)).toEqual([]);
  });
});

describe("monthsWithActivity", () => {
  it("lists the months that have something in them, newest first", () => {
    expect(monthsWithActivity(entries)).toEqual(["2026-11", "2026-10"]);
  });

  it("is empty on no transactions", () => {
    expect(monthsWithActivity([])).toEqual([]);
  });
});
