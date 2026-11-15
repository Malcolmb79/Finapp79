import { describe, expect, it } from "vitest";
import { daysApart, isDuplicatePair, isTruncationOf } from "./duplicatePair.js";

/**
 * This rule is what lets a synced transaction be deleted at all, so it decides
 * whether somebody can remove a real payment from their own ledger by calling
 * it a duplicate. It has to match the rule the screen uses to offer the row —
 * a wider server rule would let a client delete things it was never shown, and
 * a narrower one refuses what the screen just offered.
 */

const row = (booking_date: string, description: string | null) => ({ booking_date, description });

describe("isDuplicatePair", () => {
  // The strong case: the date and the amount match exactly, so the
  // description is not asked for.
  it("pairs two rows on the same day whatever they are called", () => {
    expect(isDuplicatePair(row("2026-11-11", "Example Cafe"), row("2026-11-11", "Totally different"))).toBe(true);
  });

  // The pending copy and the booked copy of one card payment.
  it("pairs a description cut short a day later", () => {
    expect(isDuplicatePair(row("2026-11-11", "help.hbomax.com"), row("2026-11-12", "help.hbomax.co"))).toBe(true);
  });

  // Two coffees, not one payment. This is the case that stops the rule being
  // a licence to delete real spending.
  it("leaves two identical descriptions on different days alone", () => {
    expect(isDuplicatePair(row("2026-11-11", "Example Cafe"), row("2026-11-12", "Example Cafe"))).toBe(false);
  });

  it("will not reach across a long gap", () => {
    expect(isDuplicatePair(row("2026-11-01", "help.hbomax.com"), row("2026-11-20", "help.hbomax.co"))).toBe(false);
  });

  it("needs something to compare when the days differ", () => {
    expect(isDuplicatePair(row("2026-11-11", null), row("2026-11-12", "help.hbomax.co"))).toBe(false);
    expect(isDuplicatePair(row("2026-11-11", ""), row("2026-11-12", ""))).toBe(false);
  });
});

describe("isTruncationOf", () => {
  it("sees a string cut short, either way round", () => {
    expect(isTruncationOf("help.hbomax.com", "help.hbomax.co")).toBe(true);
    expect(isTruncationOf("help.hbomax.co", "help.hbomax.com")).toBe(true);
  });

  it("is false for identical strings, however they are cased", () => {
    expect(isTruncationOf("Example Cafe", "example cafe")).toBe(false);
  });

  it("refuses a prefix too short to identify anything", () => {
    expect(isTruncationOf("Tes", "Tesco Stores Dublin")).toBe(false);
  });

  it("is false when neither is a prefix of the other", () => {
    expect(isTruncationOf("Example Cafe", "Example Bakery")).toBe(false);
  });
});

describe("daysApart", () => {
  it("counts whole days in either direction", () => {
    expect(daysApart("2026-11-11", "2026-11-12")).toBe(1);
    expect(daysApart("2026-11-12", "2026-11-11")).toBe(1);
    expect(daysApart("2026-11-11", "2026-11-11")).toBe(0);
  });

  it("counts across a month end", () => {
    expect(daysApart("2026-10-31", "2026-11-02")).toBe(2);
  });
});
