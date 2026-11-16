import { describe, expect, it } from "vitest";
import { propertyNumber, propertyPatch } from "./properties.js";

/**
 * A mistyped market value is not cosmetic here. It drives equity, the cap
 * rate and whatever the property contributes to net worth — and a figure with
 * an extra zero on it reads exactly like a correct one.
 */

describe("propertyNumber", () => {
  it("takes a figure, typed or sent", () => {
    expect(propertyNumber(340000, "market_value")).toBe(340000);
    expect(propertyNumber("340,000", "market_value")).toBe(340000);
    expect(propertyNumber("1 800", "monthly_rent")).toBe(1800);
  });

  /**
   * Null is "I don't know what it's worth"; zero claims it is worth nothing.
   * The metrics depend on telling those apart — an unknown value has no cap
   * rate, while a value of zero would have an infinite one.
   */
  it("keeps not knowing apart from knowing it is nothing", () => {
    expect(propertyNumber(null, "market_value")).toBeNull();
    expect(propertyNumber("", "market_value")).toBeNull();
    expect(propertyNumber(undefined, "market_value")).toBeNull();
    expect(propertyNumber(0, "market_value")).toBe(0);
  });

  it("refuses what is not a number at all", () => {
    expect(propertyNumber("about three hundred thousand", "market_value")).toBeUndefined();
    expect(propertyNumber(Number.NaN, "market_value")).toBeUndefined();
    expect(propertyNumber(true, "market_value")).toBeUndefined();
  });

  it("refuses a figure outside what a property can plausibly be", () => {
    expect(propertyNumber(-1, "market_value")).toBeUndefined();
    expect(propertyNumber(2_000_000_000, "market_value")).toBeUndefined();
    expect(propertyNumber(150, "vacancy_rate")).toBeUndefined();
    expect(propertyNumber(100, "vacancy_rate")).toBe(100);
  });
});

describe("propertyPatch", () => {
  it("takes an address, trimmed", () => {
    expect(propertyPatch({ address: "  123 Oak Street  " })).toEqual({ address: "123 Oak Street" });
  });

  it("refuses an address that is only spaces", () => {
    expect(propertyPatch({ address: "   " })).toBeNull();
    expect(propertyPatch({ address: 42 })).toBeNull();
  });

  it("takes only the types a property can be", () => {
    expect(propertyPatch({ property_type: "multi_family" })).toEqual({ property_type: "multi_family" });
    expect(propertyPatch({ property_type: "spaceship" })).toBeNull();
  });

  /**
   * Nothing is in a total until asked in, exactly as a policy behaves. `value`
   * is for a household whose mortgage is already a loan account, where
   * counting the equity would subtract the same debt twice.
   */
  it("takes the three answers to whether it counts, and no others", () => {
    for (const source of ["none", "equity", "value"]) {
      expect(propertyPatch({ net_worth_source: source })).toEqual({ net_worth_source: source });
    }
    expect(propertyPatch({ net_worth_source: "sometimes" })).toBeNull();
  });

  it("normalises a currency and refuses one that is not a code", () => {
    expect(propertyPatch({ currency: "eur" })).toEqual({ currency: "EUR" });
    expect(propertyPatch({ currency: "euros" })).toBeNull();
  });

  it("takes a purchase date, and takes it away", () => {
    expect(propertyPatch({ purchase_date: "2022-04-01" })).toEqual({ purchase_date: "2022-04-01" });
    expect(propertyPatch({ purchase_date: null })).toEqual({ purchase_date: null });
    expect(propertyPatch({ purchase_date: "01/04/2022" })).toBeNull();
  });

  // Asking for nothing is a no-op rather than a mistake, so the route can tell
  // the two apart.
  it("returns an empty patch when the body asks for nothing", () => {
    expect(propertyPatch({})).toEqual({});
  });

  it("changes only what it was asked to", () => {
    expect(propertyPatch({ market_value: 350000, monthly_rent: 1850 })).toEqual({
      market_value: 350000,
      monthly_rent: 1850,
    });
  });

  /**
   * One definition of a valid property, shared by create and update — the
   * usual way a field ends up bounded on the way in and unbounded on the way
   * back is two copies of this function.
   */
  it("rejects a bad figure wherever it arrives", () => {
    expect(propertyPatch({ address: "123 Oak Street", market_value: -5 })).toBeNull();
    expect(propertyPatch({ mortgage_payment: 5_000_000 })).toBeNull();
  });
});
