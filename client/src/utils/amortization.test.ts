import { describe, expect, it } from "vitest";
import { amortize, comparePayoff, monthlyPayment, neverClears, termLabel } from "./amortization.js";

/**
 * The figures in the first block are checkable against any mortgage
 * calculator, which is the point of using a round, ordinary loan: 300,000
 * over 30 years at 6.5% is a payment just under 1,900 and total interest
 * comfortably over 380,000.
 */

const loan = { balance: 300000, annualRate: 6.5, termMonths: 360 };

describe("monthlyPayment", () => {
  it("is the level payment that clears the balance over the term", () => {
    expect(monthlyPayment(300000, 6.5, 360)).toBeCloseTo(1896.2, 1);
  });

  /**
   * Zero interest is its own case, not a limit to approach. The standard
   * formula divides by the rate, and an interest-free plan is the most
   * ordinary loan there is.
   */
  it("divides evenly when there is no interest", () => {
    expect(monthlyPayment(1200, 0, 12)).toBe(100);
  });

  it("is nothing on nothing", () => {
    expect(monthlyPayment(0, 6.5, 360)).toBe(0);
    expect(monthlyPayment(300000, 6.5, 0)).toBe(0);
  });
});

describe("amortize", () => {
  it("runs the full term and clears the balance", () => {
    const result = amortize(loan);
    expect(result.months).toBe(360);
    expect(result.schedule[359].balance).toBe(0);
    expect(result.totalInterest).toBeGreaterThan(382000);
    expect(result.totalInterest).toBeLessThan(383000);
  });

  it("splits the first payment mostly into interest and the last mostly into principal", () => {
    const { schedule } = amortize(loan);
    expect(schedule[0].interest).toBeCloseTo(1625, 0);
    expect(schedule[0].principal).toBeLessThan(schedule[0].interest);
    expect(schedule[359].principal).toBeGreaterThan(schedule[359].interest);
  });

  /**
   * Without clamping, the final payment overshoots into a negative balance and
   * the total paid is overstated by the overshoot — a schedule that ends owing
   * minus four euro.
   */
  it("makes the last payment whatever clears it", () => {
    const { schedule } = amortize({ balance: 1000, annualRate: 12, termMonths: 6 });
    const last = schedule[schedule.length - 1];
    expect(last.balance).toBe(0);
    expect(last.payment).toBeLessThanOrEqual(schedule[0].payment);
    expect(schedule.every((row) => row.balance >= 0)).toBe(true);
  });

  /**
   * The instalment is rounded to the cent, which makes it a fraction less than
   * the exact figure the term requires — so a naive schedule collects the few
   * surviving euro in a 361st payment. A thirty-year mortgage reported as
   * thirty years and a month is wrong in a way that puts every "months saved"
   * figure beside it off by one.
   */
  it("ends on the term rather than a month past it", () => {
    for (const months of [360, 240, 120, 60]) {
      const result = amortize({ ...loan, termMonths: months });
      expect(result.months).toBe(months);
      expect(result.schedule[months - 1].balance).toBe(0);
    }
  });

  it("dates each row when given a start month, and crosses a year", () => {
    const { schedule } = amortize({ ...loan, startMonth: "2026-11" });
    expect(schedule[0].month).toBe("2026-11");
    expect(schedule[1].month).toBe("2026-12");
    expect(schedule[2].month).toBe("2027-01");
  });

  it("leaves the dates out rather than inventing a start", () => {
    expect(amortize(loan).schedule[0].month).toBeNull();
  });

  it("accumulates the interest so any row can be read as a running total", () => {
    const { schedule, totalInterest } = amortize({ balance: 1000, annualRate: 12, termMonths: 6 });
    expect(schedule[0].cumulativeInterest).toBe(schedule[0].interest);
    expect(schedule[schedule.length - 1].cumulativeInterest).toBeCloseTo(totalInterest, 2);
  });

  /**
   * A payment that does not cover the month's interest never clears the loan.
   * Looping to the cap and reporting a sixty-year term would describe the
   * situation as slow rather than as impossible.
   */
  it("produces no schedule at all when the balance would grow", () => {
    const hopeless = { balance: 10000, annualRate: 30, termMonths: 600 };
    expect(amortize(hopeless).months).toBe(0);
    expect(neverClears(hopeless)).toBe(true);
    expect(neverClears(loan)).toBe(false);
  });
});

describe("comparePayoff", () => {
  /**
   * The effect this exists to show, because nobody has the intuition for it:
   * two hundred a month extra on a thirty-year mortgage is not six per cent
   * off the term, it is years and six figures.
   */
  it("turns a small monthly extra into years and six figures", () => {
    const result = comparePayoff({ ...loan, extraMonthly: 200 });
    expect(result.standard.months).toBe(360);
    expect(result.accelerated.months).toBeLessThan(290);
    expect(result.monthsSaved).toBeGreaterThan(70);
    expect(result.interestSaved).toBeGreaterThan(100000);
  });

  it("changes nothing when nothing extra goes in", () => {
    const result = comparePayoff({ ...loan, extraMonthly: 0 });
    expect(result.monthsSaved).toBe(0);
    expect(result.interestSaved).toBe(0);
  });

  it("keeps the scheduled payment separate from what actually leaves the account", () => {
    const { accelerated } = comparePayoff({ ...loan, extraMonthly: 200 });
    expect(accelerated.monthlyPayment).toBeCloseTo(1896.2, 1);
    expect(accelerated.totalMonthly).toBeCloseTo(2096.2, 1);
  });

  /**
   * Both schedules come from one function, so the comparison cannot be between
   * two different models of the same loan — which is how a payoff tool reports
   * a "saving" that is really a difference in rounding.
   */
  it("agrees with itself when the extra is zero", () => {
    const { standard, accelerated } = comparePayoff({ ...loan, extraMonthly: 0 });
    expect(accelerated.totalInterest).toBe(standard.totalInterest);
    expect(accelerated.schedule).toEqual(standard.schedule);
  });

  it("works on a loan with no interest at all", () => {
    const result = comparePayoff({ balance: 1200, annualRate: 0, termMonths: 12, extraMonthly: 100 });
    expect(result.standard.months).toBe(12);
    expect(result.accelerated.months).toBe(6);
    expect(result.interestSaved).toBe(0);
    expect(result.monthsSaved).toBe(6);
  });
});

describe("termLabel", () => {
  it("says a term the way somebody says a mortgage", () => {
    expect(termLabel(277)).toBe("23 yr 1 mo");
    expect(termLabel(360)).toBe("30 yr");
    expect(termLabel(7)).toBe("7 mo");
  });
});
