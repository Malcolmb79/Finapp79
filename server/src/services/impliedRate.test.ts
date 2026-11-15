import { describe, expect, it } from "vitest";
import { impliedAnnualRate, isInterestCharge, type RateSample } from "./impliedRate.js";

/**
 * This figure decides which debt gets cleared first. Wrong in the low
 * direction it tells somebody to pay off a cheap loan while an expensive card
 * compounds; wrong in the high direction it does the reverse. So the rule here
 * is that it refuses rather than guesses: a result it cannot stand behind is
 * null, and the caller asks the person instead.
 */

const sample = (interest: number, balance: number, date = "2026-10-01"): RateSample => ({ date, interest, balance });

describe("isInterestCharge", () => {
  it("finds interest however the bank words it", () => {
    expect(isInterestCharge("Interest")).toBe(true);
    expect(isInterestCharge("INTEREST CHARGED")).toBe(true);
    expect(isInterestCharge("Purchase interest")).toBe(true);
    expect(isInterestCharge("Int. chg")).toBe(true);
  });

  // Each of these would inflate the rate if counted as interest.
  it("leaves fees, charges and insurance alone", () => {
    expect(isInterestCharge("Monthly fee")).toBe(false);
    expect(isInterestCharge("Late payment charge")).toBe(false);
    expect(isInterestCharge("Card insurance")).toBe(false);
    expect(isInterestCharge("Membership fee")).toBe(false);
  });

  // The same word doing the opposite job.
  it("leaves refunded interest alone", () => {
    expect(isInterestCharge("Interest refund")).toBe(false);
    expect(isInterestCharge("Interest adjustment")).toBe(false);
    expect(isInterestCharge("Reversal of interest")).toBe(false);
  });

  it("copes with nothing to read", () => {
    expect(isInterestCharge(null)).toBe(false);
    expect(isInterestCharge("")).toBe(false);
  });
});

describe("impliedAnnualRate", () => {
  // 61.40 a month on 2,424.86 owed is a bit over 30% a year.
  it("turns a month of interest into an annual rate", () => {
    const result = impliedAnnualRate([sample(61.4, 2424.86)]);
    expect(result?.rate).toBeCloseTo(30.4, 1);
  });

  // One month cannot tell an ordinary month from an odd one.
  it("calls a single month low confidence", () => {
    expect(impliedAnnualRate([sample(61.4, 2424.86)])?.confidence).toBe("low");
  });

  it("is confident when several months agree", () => {
    const result = impliedAnnualRate([
      sample(61.4, 2424.86, "2026-08-01"),
      sample(59.8, 2380.0, "2026-09-01"),
      sample(62.1, 2450.0, "2026-10-01"),
    ]);
    expect(result?.confidence).toBe("high");
    expect(result?.rate).toBeCloseTo(30.4, 0);
  });

  /**
   * The median, not the mean. A month carrying an annual fee alongside the
   * interest would pull an average up and leave the stored rate wrong for
   * every month that follows.
   */
  it("does not let one odd month carry the result", () => {
    const result = impliedAnnualRate([
      sample(61.4, 2424.86, "2026-08-01"),
      sample(300.0, 2424.86, "2026-09-01"),
      sample(62.1, 2450.0, "2026-10-01"),
    ]);
    expect(result?.rate).toBeCloseTo(30.4, 0);
    expect(result?.confidence).toBe("low");
  });

  it("ignores months that say nothing", () => {
    const result = impliedAnnualRate([sample(0, 2424.86), sample(61.4, 0), sample(61.4, 2424.86)]);
    expect(result?.samples).toHaveLength(1);
    expect(result?.rate).toBeCloseTo(30.4, 1);
  });

  it("returns nothing when there is nothing to go on", () => {
    expect(impliedAnnualRate([])).toBeNull();
    expect(impliedAnnualRate([sample(0, 0)])).toBeNull();
  });

  /**
   * A result over 100% means the balance was wrong, not that somebody is
   * paying it. The column refuses such a figure anyway, and offering it would
   * invite someone to store a number that is simply a miscalculation.
   */
  it("refuses a figure that cannot be a rate", () => {
    expect(impliedAnnualRate([sample(500, 1000)])).toBeNull();
  });

  it("keeps the charges it used, so the figure can be checked", () => {
    const result = impliedAnnualRate([sample(61.4, 2424.86, "2026-10-01")]);
    expect(result?.samples).toEqual([{ date: "2026-10-01", interest: 61.4, balance: 2424.86 }]);
  });
});
