import { describe, expect, it } from "vitest";
import { isoDate, money } from "./policies.js";

/**
 * The guards on figures that arrive typed in by hand rather than read from a
 * document. The reader has its own safeguards — quotes checked against the
 * source, values re-derived, ranges enforced — and these exist so a figure that
 * bypasses the reader entirely is held to the same standard.
 *
 * The three-way result is the point. `null` means "clear this figure",
 * `undefined` means "reject the request", and conflating them would turn a
 * mistyped cover amount into a silent erasure of the real one.
 */
describe("money", () => {
  it("accepts a figure inside the bounds", () => {
    expect(money(2_000_000, "cover_amount")).toBe(2_000_000);
    expect(money(48_213.09, "surrender_value")).toBe(48_213.09);
    expect(money(812.4, "premium")).toBe(812.4);
  });

  // A policy that has not built a value yet says so, and that is worth
  // recording rather than treating as missing.
  it("accepts zero", () => {
    expect(money(0, "surrender_value")).toBe(0);
  });

  it("treats an explicit null as clearing the figure", () => {
    expect(money(null, "cover_amount")).toBeNull();
  });

  // Rejected, not cleared — the caller gets a 400 rather than losing the
  // figure that was already there.
  it("rejects a figure beyond what a policy plausibly states", () => {
    expect(money(2_000_000_000, "cover_amount")).toBeUndefined();
    expect(money(-1, "surrender_value")).toBeUndefined();
    expect(money(5_000_000, "premium")).toBeUndefined();
  });

  it("rejects anything that isn't a finite number", () => {
    for (const value of ["2000000", NaN, Infinity, undefined, {}, []]) {
      expect(money(value, "cover_amount"), String(value)).toBeUndefined();
    }
  });

  // A column with no bounds defined would otherwise throw on the lookup and
  // surface as a 500 rather than a rejection.
  it("rejects a column it has no bounds for", () => {
    expect(money(10, "not_a_money_column")).toBeUndefined();
  });
});

describe("isoDate", () => {
  it("accepts an ISO date", () => {
    expect(isoDate("2026-06-30")).toBe("2026-06-30");
  });

  it("treats an explicit null as clearing the date", () => {
    expect(isoDate(null)).toBeNull();
  });

  it("rejects anything not in ISO form", () => {
    for (const value of ["30 June 2026", "30/06/2026", "2026-6-30", "2026-06", 20260630]) {
      expect(isoDate(value), String(value)).toBeUndefined();
    }
  });

  // Date doesn't reject an impossible day, it rolls it over — 2026-02-31
  // silently becomes 2026-03-03. A shape-only check would store the rollover.
  it("rejects a date that isn't real", () => {
    expect(isoDate("2026-02-31")).toBeUndefined();
    expect(isoDate("2026-13-01")).toBeUndefined();
    expect(isoDate("2026-00-10")).toBeUndefined();
  });
});
