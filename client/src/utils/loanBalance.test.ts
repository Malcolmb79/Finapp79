import { describe, expect, it } from "vitest";
import { impliedPrincipal } from "./loanBalance.js";

/**
 * A 4,000 loan over 36 months at 180.00 a month: 6,480.00 repayable in all,
 * and after twelve payments the lender shows 4,320.00 "remaining". That figure
 * is twenty-four instalments, not 4,320.00 of principal, and the gap between
 * them is the interest the payoff projection would otherwise charge twice.
 *
 * The figures are invented. The arithmetic is the point.
 */
describe("impliedPrincipal", () => {
  it("values the payments still to come, not their face total", () => {
    const principal = impliedPrincipal(4320.0, 180.0, 35);
    expect(principal).not.toBeNull();
    expect(principal!).toBeGreaterThan(2800);
    expect(principal!).toBeLessThan(3300);
    // The whole reason it exists: materially less than the instalments.
    expect(principal!).toBeLessThan(4320.0);
  });

  it("returns the remaining instalments when no interest is charged", () => {
    expect(impliedPrincipal(1200, 100, 0)).toBe(1200);
  });

  // Declining is the honest answer: there is no figure to offer, and inventing
  // one would be worse than leaving the lender's own number in place.
  it("declines rather than guessing when something is missing", () => {
    expect(impliedPrincipal(null, 180.0, 35)).toBeNull();
    expect(impliedPrincipal(4320.0, null, 35)).toBeNull();
    expect(impliedPrincipal(4320.0, 180.0, null)).toBeNull();
    expect(impliedPrincipal(0, 180.0, 35)).toBeNull();
    expect(impliedPrincipal(4320.0, 0, 35)).toBeNull();
  });

  it("declines a schedule that makes no sense", () => {
    expect(impliedPrincipal(50, 1000, 10)).toBeNull();
  });

  // Matches the server's copy in server/src/services/loanStatus.ts, which is
  // tested against the same numbers — the two must not drift.
  it("rounds to the penny", () => {
    const principal = impliedPrincipal(4320.0, 180.0, 35);
    expect(principal).toBe(Math.round(principal! * 100) / 100);
  });
});
