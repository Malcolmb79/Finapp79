import { describe, expect, it } from "vitest";
import { appraiseDeal, BLANK_DEAL, DEFAULT_ICR, VAT_RATE, WEAR_AND_TEAR_RATE, type DealInput } from "./btlDeal.js";

const deal = (over: Partial<DealInput> = {}): DealInput => ({ ...BLANK_DEAL, ...over });

/**
 * The reference case throughout: €300,000, 70% LTV at 4.5% over 25 years,
 * €1,800 a month in rent. Ordinary numbers, chosen so the arithmetic can be
 * checked by hand.
 */

describe("entry costs", () => {
  it("splits the price into a loan and a deposit", () => {
    const result = appraiseDeal(deal());
    expect(result.mortgageAmount).toBe(210000);
    expect(result.deposit).toBe(90000);
  });

  /**
   * No second-home surcharge in Ireland. A landlord's €300,000 purchase pays
   * €3,000, where the equivalent UK sheet would charge the 3% uplift on top.
   */
  it("charges a landlord the ordinary rate of stamp duty", () => {
    expect(appraiseDeal(deal()).stamp.total).toBe(3000);
  });

  it("counts everything that has to be found in cash", () => {
    const result = appraiseDeal(deal({ refurbCost: 25000, furnishingsCost: 8000 }));
    // Deposit 90,000 + fees 3,500 + stamp 3,000 + refurb 25,000 + furnishings 8,000.
    expect(result.cashRequired).toBe(129500);
  });

  // Rolled into the loan, so borrowed rather than found — and charged interest.
  it("finances the arrangement fee rather than asking for it in cash", () => {
    const withFee = appraiseDeal(deal({ arrangementFees: 2000 }));
    const without = appraiseDeal(deal({ arrangementFees: 0 }));
    expect(withFee.cashRequired).toBe(without.cashRequired);
    expect(withFee.monthlyMortgage).toBeGreaterThan(without.monthlyMortgage);
  });
});

describe("the mortgage", () => {
  it("charges interest only on an interest-only loan, and repays nothing", () => {
    const result = appraiseDeal(deal({ interestOnly: true }));
    expect(result.annualInterest).toBe(210000 * 0.045);
    expect(result.annualCapital).toBe(0);
    expect(result.monthlyMortgage).toBeCloseTo(787.5, 2);
  });

  /**
   * The distinction a UK sheet sidesteps by assuming interest-only, which is
   * the normal UK product and the unusual Irish one. On a repayment mortgage
   * the cash flow carries the whole instalment while the tax computation
   * deducts only the interest part.
   */
  it("separates interest from capital on a repayment loan", () => {
    const result = appraiseDeal(deal());
    expect(result.annualInterest + result.annualCapital).toBeCloseTo(result.annualMortgage, 0);
    // Early payments are nearly all interest.
    expect(result.annualInterest).toBeGreaterThan(result.annualCapital * 1.5);
  });

  // Averaging across the term would understate the deductible part in exactly
  // the years being appraised.
  it("takes the first year of the real schedule, not an average of the term", () => {
    const result = appraiseDeal(deal());
    const flatAverage = (result.annualMortgage * 25 - 210000) / 25;
    expect(result.annualInterest).toBeGreaterThan(flatAverage);
  });
});

describe("income and costs", () => {
  it("allows for the months it sits empty", () => {
    const result = appraiseDeal(deal({ vacancyRate: 5 }));
    expect(result.grossMonthlyRent).toBe(1800);
    expect(result.effectiveMonthlyRent).toBe(1710);
  });

  it("charges Irish VAT on the agent's fee, not British", () => {
    const result = appraiseDeal(deal({ managementRate: 10, vacancyRate: 0 }));
    const management = result.costs.find((c) => c.label.startsWith("Management"));
    expect(management?.monthly).toBeCloseTo(1800 * 0.1 * (1 + VAT_RATE), 2);
    expect(management?.label).toContain("23% VAT");
  });

  /**
   * Local Property Tax falls on the owner here. UK council tax is usually the
   * tenant's, so a UK sheet has no line for it at all and quietly overstates
   * the profit by it every month.
   */
  it("charges the owner for Local Property Tax", () => {
    const result = appraiseDeal(deal({ lptAnnual: 600 }));
    expect(result.costs.find((c) => c.label === "Local Property Tax")?.monthly).toBe(50);
  });

  it("charges RTB registration per unit", () => {
    const result = appraiseDeal(deal({ units: 3, rtbFeeAnnual: 40 }));
    expect(result.costs.find((c) => c.label === "RTB registration")?.monthly).toBe(10);
  });

  it("leaves out the cost lines that are zero rather than listing empty rows", () => {
    const result = appraiseDeal(deal({ serviceChargeMonthly: 0, otherMonthly: 0 }));
    expect(result.costs.map((c) => c.label)).not.toContain("Other");
    expect(result.costs.map((c) => c.label)).not.toContain("Service charge & ground rent");
  });
});

describe("cash flow against taxable profit", () => {
  /**
   * The gap is the point. Capital repaid is cash gone and not an expense;
   * wear and tear is an expense with no cash attached. One number for both
   * would be wrong by the sum of the two.
   */
  it("adds capital back and takes wear and tear off", () => {
    const result = appraiseDeal(deal({ furnishingsCost: 8000 }));
    expect(result.wearAndTear).toBe(8000 * WEAR_AND_TEAR_RATE);
    expect(result.taxableProfit).toBeCloseTo(result.annualCashFlow + result.annualCapital - result.wearAndTear, 2);
    // Taxable profit is higher than cash flow on a repayment mortgage, which
    // is the uncomfortable truth of a geared Irish deal.
    expect(result.taxableProfit).toBeGreaterThan(result.annualCashFlow);
  });

  it("has no gap at all on an interest-only loan with nothing furnished", () => {
    const result = appraiseDeal(deal({ interestOnly: true, furnishingsCost: 0 }));
    expect(result.taxableProfit).toBeCloseTo(result.annualCashFlow, 2);
  });
});

describe("the lender's test", () => {
  it("stresses the rate rather than testing today's", () => {
    const result = appraiseDeal(deal());
    expect(result.icr.stressedPayment).toBeGreaterThan(result.monthlyMortgage);
  });

  it("says plainly when the rent does not cover it", () => {
    const thin = appraiseDeal(deal({ rentPerUnit: 1100 }));
    expect(thin.icr.passes).toBe(false);
    expect(thin.warnings.join(" ")).toContain("stressed mortgage");
  });

  it("passes a deal with room in it", () => {
    const strong = appraiseDeal(deal({ rentPerUnit: 2400 }));
    expect(strong.icr.passes).toBe(true);
    expect(strong.icr.cover).toBeGreaterThan(DEFAULT_ICR);
  });
});

describe("value and yields", () => {
  it("reads equity against the value after works, not the price paid", () => {
    const result = appraiseDeal(deal({ refurbCost: 25000, valueAfterWorks: 360000 }));
    expect(result.valueAdded).toBe(60000);
    expect(result.equity).toBe(150000);
    expect(result.equityAfterRefurb).toBe(125000);
  });

  // The refinance test on a works-and-refinance deal.
  it("gives the loan to value once the works are done", () => {
    const result = appraiseDeal(deal({ valueAfterWorks: 400000 }));
    expect(result.newLtv).toBeCloseTo(0.525, 3);
  });

  it("measures cash-on-cash against the money actually put in", () => {
    const result = appraiseDeal(deal());
    expect(result.cashOnCash).toBeCloseTo(result.annualCashFlow / result.cashRequired, 4);
  });

  it("has no yield to report on a price of nothing", () => {
    const result = appraiseDeal(deal({ purchasePrice: 0 }));
    expect(result.grossYield).toBeNull();
    expect(result.perHundredThousand).toBeNull();
  });
});

describe("ownership", () => {
  /**
   * The conclusion that flips at the border. A UK sheet ends up recommending a
   * limited company because Section 24 makes personal ownership punitive.
   * Here a close company pays 25% and another 20% on what it retains.
   */
  it("reports both routes whichever one is chosen", () => {
    const result = appraiseDeal(deal({ ownership: "personal" }));
    expect(result.personal).toBeDefined();
    expect(result.company).toBeDefined();
    expect(result.tax).toBe(result.personal);
    expect(appraiseDeal(deal({ ownership: "company" })).tax).toEqual(result.company);
  });

  it("takes the after-tax figure off the cash the property actually generated", () => {
    const result = appraiseDeal(deal());
    expect(result.annualAfterTax).toBeCloseTo(result.annualCashFlow - result.tax.total, 2);
    expect(result.monthlyAfterTax).toBeCloseTo(result.annualAfterTax / 12, 2);
  });
});

describe("warnings", () => {
  it("names the RTB deadline, because the interest deduction hangs on it", () => {
    expect(appraiseDeal(deal({ rtbRegistered: false })).warnings.join(" ")).toContain("RTB");
  });

  it("objects to a model with no vacancy allowance in it", () => {
    expect(appraiseDeal(deal({ vacancyRate: 0 })).warnings.join(" ")).toContain("full occupancy");
  });

  it("objects to borrowing more than an Irish lender would advance", () => {
    expect(appraiseDeal(deal({ ltv: 0.85 })).warnings.join(" ")).toContain("70%");
  });

  it("says when the deal loses money every month", () => {
    expect(appraiseDeal(deal({ rentPerUnit: 600 })).warnings.join(" ")).toContain("costs money every month");
  });

  it("has nothing to object to in a sound deal", () => {
    const sound = appraiseDeal(deal({ rentPerUnit: 2400, vacancyRate: 5, ltv: 0.7, rtbRegistered: true }));
    expect(sound.warnings).toEqual([]);
  });
});
