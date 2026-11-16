import { describe, expect, it } from "vitest";
import type { Property } from "../api/client.js";
import {
  countsAtValue,
  dscrVerdict,
  portfolioTotals,
  propertyContribution,
  propertyContributions,
  propertyContributionsAt,
  propertyMetrics,
} from "./propertyMetrics.js";

const property = (over: Partial<Property> = {}): Property =>
  ({
    id: "p1",
    address: "123 Oak Street",
    property_type: "rental",
    currency: "EUR",
    purchase_price: 320000,
    purchase_date: "2022-04-01",
    market_value: 340000,
    mortgage_balance: 198000,
    mortgage_payment: 1000,
    monthly_rent: 1800,
    monthly_expenses: 380,
    vacancy_rate: 5,
    net_worth_source: "none",
    notes: null,
    created_at: "2026-01-01",
    ...over,
  }) as Property;

describe("propertyMetrics", () => {
  it("gives equity as value less what is owed, not what was put in", () => {
    expect(propertyMetrics(property()).equity).toBe(142000);
  });

  /**
   * A vacancy allowance belongs in the income rather than in the costs: an
   * empty month does not cost money, it fails to earn it.
   */
  it("takes vacancy off the rent rather than adding it to the costs", () => {
    const metrics = propertyMetrics(property());
    expect(metrics.effectiveRent).toBe(1710);
    expect(metrics.noi).toBe(1330);
  });

  /**
   * NOI is before the mortgage, and that exclusion is the whole point of the
   * measure: it says what the building earns, separately from how the buyer
   * financed it. Fold the mortgage in and two identical houses report
   * different performance because one owner borrowed more.
   */
  it("leaves the mortgage out of NOI and puts it into cash flow", () => {
    const heavily = propertyMetrics(property({ mortgage_payment: 1600 }));
    const lightly = propertyMetrics(property({ mortgage_payment: 200 }));
    expect(heavily.noi).toBe(lightly.noi);
    expect(heavily.cashFlow).toBe(-270);
    expect(lightly.cashFlow).toBe(1130);
  });

  it("gives a cap rate as the unlevered annual yield on value", () => {
    expect(propertyMetrics(property()).capRate).toBeCloseTo(4.69, 2);
  });

  it("gives DSCR as what the building earns over what the mortgage costs", () => {
    expect(propertyMetrics(property()).dscr).toBeCloseTo(1.33, 2);
    expect(propertyMetrics(property({ mortgage_payment: 1600 })).dscr).toBeCloseTo(0.83, 2);
  });

  /**
   * Null rather than zero, every time. A property with no value recorded has
   * an unknown cap rate, not a cap rate of nothing, and a column of confident
   * zeroes is how a portfolio gets judged on figures nobody entered.
   */
  it("says nothing rather than zero when the figure it needs is missing", () => {
    const blank = propertyMetrics(property({ market_value: null, monthly_rent: null }));
    expect(blank.equity).toBeNull();
    expect(blank.noi).toBeNull();
    expect(blank.capRate).toBeNull();
    expect(blank.dscr).toBeNull();
    expect(blank.cashFlow).toBeNull();
  });

  // Otherwise it prints "∞%" and looks like a spectacular asset.
  it("refuses a yield on a value of nothing", () => {
    expect(propertyMetrics(property({ market_value: 0 })).capRate).toBeNull();
  });

  /**
   * Nothing to cover is not a coverage of zero, and not an infinitely good one
   * either. A property that owes nothing simply has no ratio.
   */
  it("has no coverage ratio where there is no mortgage", () => {
    const owesNothing = property({ mortgage_payment: 0 });
    expect(propertyMetrics(owesNothing).dscr).toBeNull();
    expect(dscrVerdict(null, owesNothing).label).toContain("No mortgage");
  });

  /**
   * The absent ratio is two different facts and has to say which. Collapsing
   * them printed "No mortgage to cover" under a house carrying two hundred and
   * ninety-eight thousand of one — not a vaguer truth but a different claim.
   */
  it("tells a property that owes nothing from one that earns nothing", () => {
    const home = property({ property_type: "residence", monthly_rent: null, mortgage_payment: 2100 });
    expect(propertyMetrics(home).dscr).toBeNull();
    expect(dscrVerdict(null, home).label).toContain("Earns nothing");
    expect(dscrVerdict(null, home).label).not.toContain("No mortgage");
  });

  it("ignores a vacancy rate that is not a percentage", () => {
    expect(propertyMetrics(property({ vacancy_rate: 150 })).effectiveRent).toBe(1800);
    expect(propertyMetrics(property({ vacancy_rate: -5 })).effectiveRent).toBe(1800);
  });

  it("handles a home nobody rents out", () => {
    const home = propertyMetrics(property({ property_type: "residence", monthly_rent: null, mortgage_payment: 1200 }));
    expect(home.equity).toBe(142000);
    expect(home.noi).toBeNull();
    expect(home.dscr).toBeNull();
  });
});

describe("dscrVerdict", () => {
  it("says what the ratio means, because the number alone means nothing to most people", () => {
    expect(dscrVerdict(1.4).tone).toBe("good");
    expect(dscrVerdict(1.05).label).toContain("Just covers");
    expect(dscrVerdict(0.83).tone).toBe("bad");
    expect(dscrVerdict(0.83).label).toContain("Does not cover");
  });
});

describe("portfolioTotals", () => {
  const two = [property(), property({ id: "p2", market_value: 520000, mortgage_balance: 298000, monthly_rent: null, mortgage_payment: 1500, monthly_expenses: 0, property_type: "residence" })];

  it("adds what there is to add", () => {
    const totals = portfolioTotals(two);
    expect(totals.value).toBe(860000);
    expect(totals.mortgages).toBe(496000);
    expect(totals.equity).toBe(364000);
    expect(totals.monthlyRent).toBe(1710);
    expect(totals.monthlyNoi).toBe(1330);
  });

  /**
   * A portfolio NOI that silently treats un-costed houses as earning nothing
   * understates by exactly the amount nobody has entered yet — and reads as a
   * bad portfolio rather than an unfinished one.
   */
  it("counts what it had to leave out rather than hiding it", () => {
    const totals = portfolioTotals([...two, property({ id: "p3", market_value: null })]);
    expect(totals.incomplete).toBe(1);
    expect(totals.value).toBe(860000);
  });

  it("is all zeroes and nothing missing on an empty portfolio", () => {
    expect(portfolioTotals([])).toEqual({
      value: 0,
      mortgages: 0,
      equity: 0,
      monthlyRent: 0,
      monthlyNoi: 0,
      monthlyCashFlow: 0,
      incomplete: 0,
    });
  });
});

describe("propertyContribution", () => {
  // Nothing until asked in, exactly as a policy behaves.
  it("contributes nothing by default", () => {
    expect(propertyContribution(property())).toBe(0);
  });

  it("contributes its equity when asked to", () => {
    expect(propertyContribution(property({ net_worth_source: "equity" }))).toBe(142000);
  });

  /**
   * The case `value` exists for: a mortgage already tracked as a loan account.
   * Counting the equity there would subtract the same debt twice.
   */
  it("contributes the whole value when the mortgage is counted elsewhere, and says so", () => {
    const counted = property({ net_worth_source: "value" });
    expect(propertyContribution(counted)).toBe(340000);
    expect(countsAtValue(counted)).toBe(true);
    // Nothing to admit when there is no mortgage to have excluded.
    expect(countsAtValue(property({ net_worth_source: "value", mortgage_balance: 0 }))).toBe(false);
  });

  /**
   * The same shape and the same name-ending as policyContributions and
   * holdingContributions, because every screen that builds a net worth figure
   * has to add all three or disagree with the ones that do.
   */
  it("lists only the properties asked in", () => {
    const mixed = [property({ net_worth_source: "equity" }), property({ id: "p2" }), property({ id: "p3", net_worth_source: "value" })];
    expect(propertyContributions(mixed)).toEqual([
      { amount: 142000, currency: "EUR" },
      { amount: 340000, currency: "EUR" },
    ]);
  });
});

describe("propertyContributionsAt", () => {
  const held = property({ net_worth_source: "equity", purchase_date: "2022-04-01" });

  /**
   * Projecting a property backwards past its purchase would show a household
   * owning a house in years it did not — the worse of the two available
   * errors, because it invents wealth rather than merely flattening it.
   */
  it("contributes nothing before it was bought", () => {
    expect(propertyContributionsAt([held], "2022-03-31")).toEqual([]);
    expect(propertyContributionsAt([held], "2022-04-01")).toEqual([{ amount: 142000, currency: "EUR" }]);
  });

  // Flat rather than tracking the market: there is no valuation history behind
  // a property the way there is behind a policy. An approximation, and
  // visibly one.
  it("carries today's figure across every year it was held", () => {
    expect(propertyContributionsAt([held], "2023-01-01")).toEqual(propertyContributionsAt([held], "2026-01-01"));
  });

  it("falls back to when it was entered when no purchase date was given", () => {
    const entered = property({ net_worth_source: "equity", purchase_date: null, created_at: "2025-06-10T00:00:00Z" });
    expect(propertyContributionsAt([entered], "2025-06-09")).toEqual([]);
    expect(propertyContributionsAt([entered], "2025-06-10")).toHaveLength(1);
  });

  it("leaves out a property nobody asked in, however long it was held", () => {
    expect(propertyContributionsAt([property({ purchase_date: "2000-01-01" })], "2026-01-01")).toEqual([]);
  });
});
