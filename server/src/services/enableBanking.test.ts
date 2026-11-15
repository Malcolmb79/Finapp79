import { describe, expect, it } from "vitest";
import { isSettled } from "./enableBanking.js";

/**
 * A bank reports a payment twice: once as expected, once as recorded. Both
 * carry their own reference, so both pass the id-based dedupe and both land.
 * This is the gate that stops the first one being stored at all.
 */
describe("isSettled", () => {
  it("keeps money that has moved", () => {
    expect(isSettled("BOOK")).toBe(true);
  });

  it("drops the statuses that are not settled money", () => {
    expect(isSettled("PDNG")).toBe(false);
    expect(isSettled("CNCL")).toBe(false);
    expect(isSettled("RJCT")).toBe(false);
    expect(isSettled("SCHD")).toBe(false);
    expect(isSettled("HOLD")).toBe(false);
  });

  /**
   * The two ways to be wrong are not equal. An entry kept wrongly shows a
   * payment early and may need a duplicate cleared; an entry dropped wrongly
   * disappears silently, and a bank that labels everything OTHR would have
   * its account quietly stop updating.
   */
  it("keeps an unknown or missing status rather than losing the transaction", () => {
    expect(isSettled("OTHR")).toBe(true);
    expect(isSettled(undefined)).toBe(true);
    expect(isSettled(null)).toBe(true);
    expect(isSettled("")).toBe(true);
  });

  it("does not care about case or stray spacing", () => {
    expect(isSettled(" pdng ")).toBe(false);
    expect(isSettled("book")).toBe(true);
  });
});
