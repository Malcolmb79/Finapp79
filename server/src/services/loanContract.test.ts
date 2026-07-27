import { describe, expect, it } from "vitest";
import { verifyNumber, verifyDate } from "./loanContract.js";

/**
 * These guard the one place in the app where a model reads figures rather than
 * labels. The model's answer is only accepted when the sentence it quoted
 * actually contains the number it reported — so these tests are about what
 * happens when it doesn't.
 */
describe("verifyNumber", () => {
  const bounds = { min: 1, max: 10_000_000 };

  it("accepts a figure the quote supports", () => {
    expect(
      verifyNumber({ value: 4312.88, quote: "repayable in 60 instalments of R4,312.88 each" }, bounds)
    ).toEqual({ value: 4312.88, quote: "repayable in 60 instalments of R4,312.88 each" });
  });

  it("reads both decimal conventions", () => {
    // European contracts write 4.312,88 for the same amount.
    expect(verifyNumber({ value: 4312.88, quote: "Rate van 4.312,88 per maand" }, bounds)?.value).toBe(4312.88);
  });

  // The failure this whole design exists to catch: a plausible number that
  // isn't in the document.
  it("rejects a figure the quote does not contain", () => {
    expect(verifyNumber({ value: 4500, quote: "instalments of R4,312.88 each" }, bounds)).toBeNull();
  });

  it("rejects a near miss rather than rounding to it", () => {
    expect(verifyNumber({ value: 4312.9, quote: "instalments of R4,312.88" }, bounds)).toBeNull();
  });

  it("rejects figures outside plausible bounds", () => {
    expect(verifyNumber({ value: 400, quote: "interest at 400% per annum" }, { min: 0, max: 100 })).toBeNull();
  });

  it("rejects an answer with no quote at all", () => {
    expect(verifyNumber({ value: 4312.88, quote: "" }, bounds)).toBeNull();
    expect(verifyNumber(null, bounds)).toBeNull();
  });

  it("accepts a whole number written without decimals", () => {
    expect(verifyNumber({ value: 60, quote: "repayable over 60 months" }, { min: 1, max: 600 })?.value).toBe(60);
  });
});

describe("verifyDate", () => {
  it("accepts an ISO date with a quote", () => {
    expect(verifyDate({ value: "2026-03-01", quote: "commencing 1 March 2026" })).toEqual({
      value: "2026-03-01",
      quote: "commencing 1 March 2026",
    });
  });

  it("rejects anything not in ISO form", () => {
    for (const value of ["1 March 2026", "01/03/2026", "2026-3-1", "March 2026"]) {
      expect(verifyDate({ value, quote: "commencing 1 March 2026" }), value).toBeNull();
    }
  });

  it("rejects a year that can only be a misread", () => {
    expect(verifyDate({ value: "0202-03-01", quote: "commencing 1 March 2026" })).toBeNull();
    expect(verifyDate({ value: "2926-03-01", quote: "commencing 1 March 2026" })).toBeNull();
  });

  it("rejects a date that isn't real", () => {
    expect(verifyDate({ value: "2026-02-31", quote: "commencing 31 February 2026" })).toBeNull();
  });
});
