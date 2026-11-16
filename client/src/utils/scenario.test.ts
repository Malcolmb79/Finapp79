import { describe, expect, it } from "vitest";
import { applyScenario, baseScenario, EMPTY_CHANGE, scenarioVerdict, type Baseline } from "./scenario.js";

const money = (value: number) => `€${value.toFixed(0)}`;

const baseline: Baseline = {
  netWorth: 520413,
  monthlyIncome: 10670,
  monthlyExpenses: 4239,
  investable: 111713,
};

const change = (over: Partial<Parameters<typeof applyScenario>[1]>) => ({
  name: "Scenario",
  ...EMPTY_CHANGE,
  ...over,
});

describe("baseScenario", () => {
  it("is the household exactly as it is", () => {
    const now = baseScenario(baseline);
    expect(now.netWorth).toBe(520413);
    expect(now.monthlyCashFlow).toBe(6431);
    expect(now.annualExpenses).toBe(50868);
  });

  // Nothing to compare against yet, so every delta is zero rather than a
  // comparison with itself dressed up as a result.
  it("has no deltas, because there is nothing to differ from", () => {
    const now = baseScenario(baseline);
    expect(now.delta).toEqual({ netWorth: 0, cashFlow: 0, fireTarget: 0, fireMonths: null });
    expect(scenarioVerdict(now, money)).toBe("No different from where you are");
  });
});

describe("applyScenario", () => {
  const now = baseScenario(baseline);

  it("moves income and expenses by their deltas", () => {
    const result = applyScenario(baseline, change({ incomeChange: 600, expenseChange: 200 }), now);
    expect(result.monthlyIncome).toBe(11270);
    expect(result.monthlyExpenses).toBe(4439);
    expect(result.monthlyCashFlow).toBe(6831);
    expect(result.delta.cashFlow).toBe(400);
  });

  it("takes debt off net worth and an asset onto it", () => {
    const result = applyScenario(baseline, change({ assetChange: 35000, debtChange: 30000 }), now);
    expect(result.netWorth).toBe(525413);
    expect(result.delta.netWorth).toBe(5000);
  });

  it("clearing debt raises net worth", () => {
    const result = applyScenario(baseline, change({ debtChange: -30000 }), now);
    expect(result.delta.netWorth).toBe(30000);
  });

  /**
   * The toggle that exists because treating these the same would quietly
   * promise an earlier retirement than the one on offer. Thirty thousand in an
   * index fund brings the date forward; thirty thousand of equity in the house
   * you live in does not, because it does not pay for groceries.
   */
  it("only counts an asset towards independence when told to", () => {
    const house = applyScenario(baseline, change({ assetChange: 200000 }), now);
    const fund = applyScenario(baseline, change({ assetChange: 200000, assetIsInvestable: true }), now);

    expect(house.investable).toBe(baseline.investable);
    expect(fund.investable).toBe(baseline.investable + 200000);
    expect(fund.fire.months!).toBeLessThan(house.fire.months!);
    // And both are the same amount better off today, which is the point: the
    // difference is about what the money can do, not about how much there is.
    expect(fund.netWorth).toBe(house.netWorth);
  });

  it("raises the target when spending rises, because the pot has to cover it", () => {
    const result = applyScenario(baseline, change({ expenseChange: 1000 }), now);
    expect(result.fire.target).toBe((baseline.monthlyExpenses + 1000) * 12 * 25);
    expect(result.delta.fireTarget).toBe(12000 * 25);
    // Spending more pushes the date out twice over — a bigger target reached
    // with a smaller surplus — which is exactly what a planner should show.
    expect(result.fire.months!).toBeGreaterThan(now.fire.months!);
  });

  /**
   * A deficit is borrowing, not negative saving. Fed in as a negative
   * contribution it would have the pot pay for the shortfall, which is the one
   * thing it must never quietly do.
   */
  it("does not let a shortfall eat the pot", () => {
    const result = applyScenario(baseline, change({ expenseChange: 8000 }), now);
    expect(result.monthlyCashFlow).toBeLessThan(0);
    expect(result.fire.blocker).toBe("spending-more-than-earned");
    expect(result.fire.months).toBeNull();
  });

  it("reports months earlier as a positive number", () => {
    const result = applyScenario(baseline, change({ incomeChange: 2700, expenseChange: -400 }), now);
    expect(result.delta.fireMonths).toBeGreaterThan(0);
  });

  // Four years earlier than a future that never arrives is not four years of
  // anything.
  it("gives no month delta when either side never arrives", () => {
    const result = applyScenario(baseline, change({ expenseChange: 8000 }), now);
    expect(result.delta.fireMonths).toBeNull();
  });
});

describe("scenarioVerdict", () => {
  const now = baseScenario(baseline);

  it("leads with the date, because that is what people reach for", () => {
    const result = applyScenario(baseline, change({ incomeChange: 2000 }), now);
    const verdict = scenarioVerdict(result, money);
    expect(verdict).toMatch(/sooner/);
    expect(verdict).toContain("€2000 a month more");
  });

  it("says plainly when a change makes things worse", () => {
    const result = applyScenario(baseline, change({ expenseChange: 500 }), now);
    const verdict = scenarioVerdict(result, money);
    expect(verdict).toMatch(/later/);
    expect(verdict).toContain("€500 a month less");
  });

  it("mentions being better off today when only the balance sheet moved", () => {
    const result = applyScenario(baseline, change({ debtChange: -10000 }), now);
    expect(scenarioVerdict(result, money)).toBe("€10000 better off today");
  });
});
