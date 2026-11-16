import { describe, expect, it } from "vitest";
import { dealNumber, dealPatch } from "./btlDeals.js";

/**
 * Twenty-five writable fields, which is exactly the count at which
 * hand-written validation starts quietly missing one. The bounds live in a
 * table for that reason, and these tests check the table is actually consulted
 * rather than that each field was remembered.
 */

describe("dealNumber", () => {
  it("takes a figure, typed or sent", () => {
    expect(dealNumber(300000, "purchase_price")).toBe(300000);
    expect(dealNumber("300,000", "purchase_price")).toBe(300000);
    expect(dealNumber("1 800", "rent_per_unit")).toBe(1800);
  });

  it("holds each field to its own range", () => {
    expect(dealNumber(0.7, "ltv")).toBe(0.7);
    expect(dealNumber(1.4, "ltv")).toBeUndefined();
    expect(dealNumber(150, "vacancy_rate")).toBeUndefined();
    expect(dealNumber(100, "vacancy_rate")).toBe(100);
    expect(dealNumber(60, "term_years")).toBeUndefined();
  });

  it("refuses what is not a number", () => {
    expect(dealNumber("about three hundred thousand", "purchase_price")).toBeUndefined();
    expect(dealNumber(Number.NaN, "purchase_price")).toBeUndefined();
    expect(dealNumber(true, "purchase_price")).toBeUndefined();
  });

  // Half a flat is not a thing to let.
  it("rounds a unit count to a whole number", () => {
    expect(dealNumber(2.6, "units")).toBe(3);
  });

  it("refuses a column it has no bounds for, rather than letting it through", () => {
    expect(dealNumber(5, "not_a_field")).toBeUndefined();
  });
});

describe("dealPatch", () => {
  it("takes a name, trimmed", () => {
    expect(dealPatch({ name: "  12 The Crescent  " })).toEqual({ name: "12 The Crescent" });
  });

  it("refuses a name that is only spaces", () => {
    expect(dealPatch({ name: "   " })).toBeNull();
    expect(dealPatch({ name: 42 })).toBeNull();
  });

  it("takes only the two ways a deal can be owned", () => {
    expect(dealPatch({ ownership: "company" })).toEqual({ ownership: "company" });
    expect(dealPatch({ ownership: "trust" })).toBeNull();
  });

  it("takes the flags as booleans and nothing else", () => {
    expect(dealPatch({ interest_only: true, rtb_registered: false })).toEqual({
      interest_only: true,
      rtb_registered: false,
    });
    expect(dealPatch({ interest_only: "yes" })).toBeNull();
  });

  it("normalises a currency and refuses one that is not a code", () => {
    expect(dealPatch({ currency: "eur" })).toEqual({ currency: "EUR" });
    expect(dealPatch({ currency: "euros" })).toBeNull();
  });

  it("changes only what it was asked to", () => {
    expect(dealPatch({ purchase_price: 320000, rent_per_unit: 1900 })).toEqual({
      purchase_price: 320000,
      rent_per_unit: 1900,
    });
  });

  // Asking for nothing is a no-op rather than a mistake, so the route can tell
  // the two apart.
  it("returns an empty patch when the body asks for nothing", () => {
    expect(dealPatch({})).toEqual({});
  });

  /**
   * One definition of a valid deal, shared by create and update — two copies
   * is how a field ends up bounded on the way in and unbounded on the way back.
   */
  it("rejects a bad figure wherever it arrives", () => {
    expect(dealPatch({ name: "A deal", ltv: 2 })).toBeNull();
    expect(dealPatch({ marginal_rate: 1.5 })).toBeNull();
  });

  it("ignores a field that is not writable rather than refusing the request", () => {
    expect(dealPatch({ id: "something", user_id: "someone-else", name: "Mine" })).toEqual({ name: "Mine" });
  });
});
