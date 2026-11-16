import { describe, expect, it } from "vitest";
import { coastsBy, coastValue, fireDate, fireNumber, fireTimeline, projectFire } from "./fire.js";

/**
 * The two errors this is built to avoid are both optimistic, which is why they
 * survive in so many calculators: counting the house somebody lives in as part
 * of the pot, and growing that pot at a nominal return against a target that
 * was never inflated. Both bring the date forward on money that is not there.
 */

describe("fireNumber", () => {
  it("is the annual spend at the withdrawal rate", () => {
    expect(fireNumber(40000)).toBe(1000000);
    expect(fireNumber(40000, 0.035)).toBeCloseTo(1142857, 0);
  });

  it("refuses a withdrawal rate of nothing rather than dividing by it", () => {
    expect(fireNumber(40000, 0)).toBe(Infinity);
  });
});

describe("projectFire", () => {
  const base = { investable: 100000, monthlySaving: 2000, annualExpenses: 40000 };

  it("reaches the target and says when", () => {
    const result = projectFire(base);
    expect(result.target).toBe(1000000);
    expect(result.months).toBeGreaterThan(0);
    // A rough sanity bound rather than an exact month: 100k compounding at 5%
    // real with 24k a year added takes somewhere around two decades, and a
    // figure far outside that would mean the compounding is wrong.
    expect(result.months! / 12).toBeGreaterThan(15);
    expect(result.months! / 12).toBeLessThan(25);
  });

  it("knows when somebody is already there", () => {
    const result = projectFire({ ...base, investable: 1200000 });
    expect(result.months).toBe(0);
    expect(result.progress).toBeCloseTo(1.2, 2);
    expect(fireTimeline(result)).toBe("Already there");
  });

  /**
   * Saving nothing is not the same as going backwards. A pot large enough to
   * compound into the target on its own is coasting, which is a real position
   * somebody can be in, and reporting it as unreachable would be wrong.
   */
  it("still arrives on a pot that coasts, with nothing added", () => {
    const result = projectFire({ ...base, monthlySaving: 0 });
    expect(result.blocker).toBeNull();
    expect(result.months).toBeGreaterThan(0);
  });

  it("says so when the rate is simply too slow to get there", () => {
    expect(projectFire({ investable: 0, monthlySaving: 5, annualExpenses: 40000 }).blocker).toBe("too-slow");
  });

  /**
   * A deficit is refused up front rather than projected through. The pot would
   * still compound, so the projection happily reports a date decades out —
   * while the shortfall funding each month is borrowing this model does not
   * track at all.
   */
  it("refuses to date a retirement funded by going further into debt", () => {
    const result = projectFire({ ...base, monthlySaving: -500 });
    expect(result.blocker).toBe("spending-more-than-earned");
    expect(result.months).toBeNull();
    expect(fireTimeline(result)).toContain("more goes out than comes in");
    // Even a single euro of deficit: the sign is the fact, not the size.
    expect(projectFire({ ...base, monthlySaving: -1 }).months).toBeNull();
  });

  // Nobody has retired on spending nothing; they have just not entered it yet.
  it("does not declare independence on no recorded spending", () => {
    const result = projectFire({ ...base, annualExpenses: 0 });
    expect(result.blocker).toBe("no-expenses");
    expect(result.months).toBeNull();
    expect(fireTimeline(result)).toBe("No spending recorded yet");
  });

  /**
   * Everything is in today's money, so a higher real return is the only thing
   * that moves the date — the target does not need inflating to match.
   */
  it("arrives sooner on a better real return, with the target unchanged", () => {
    const slow = projectFire({ ...base, realReturn: 0.02 });
    const fast = projectFire({ ...base, realReturn: 0.08 });
    expect(fast.months!).toBeLessThan(slow.months!);
    expect(fast.target).toBe(slow.target);
  });

  it("needs a bigger pot at a more cautious withdrawal rate, and takes longer", () => {
    const four = projectFire(base);
    const three = projectFire({ ...base, withdrawalRate: 0.03 });
    expect(three.target).toBeGreaterThan(four.target);
    expect(three.months!).toBeGreaterThan(four.months!);
  });

  it("gives a path that starts where the pot is and ends at the target", () => {
    const result = projectFire(base);
    expect(result.path[0]).toEqual({ year: 0, value: 100000 });
    expect(result.path[result.path.length - 1].value).toBeGreaterThanOrEqual(result.target);
  });

  it("dates the arrival as a month", () => {
    const result = projectFire({ ...base, investable: 999000, monthlySaving: 2000 });
    expect(fireDate(result, new Date("2026-11-16T00:00:00Z"))).toMatch(/^\d{4}-\d{2}$/);
    expect(fireDate(projectFire({ ...base, monthlySaving: -500 }))).toBeNull();
  });

  it("formats a timeline the way somebody would say it", () => {
    expect(fireTimeline({ ...projectFire(base), months: 88 })).toBe("7 yr 4 mo");
    expect(fireTimeline({ ...projectFire(base), months: 24 })).toBe("2 years");
    expect(fireTimeline({ ...projectFire(base), months: 5 })).toBe("5 months");
  });
});

describe("coasting", () => {
  it("compounds what is already there with nothing added", () => {
    expect(coastValue(100000, 10, 0.05)).toBeCloseTo(162889, 0);
    expect(coastValue(100000, 0)).toBe(100000);
  });

  /**
   * The question people ask and calculators rarely answer: not "when can I
   * stop working" but "when can I stop saving".
   */
  it("says when the pot gets there on its own", () => {
    const years = coastsBy({ investable: 600000, monthlySaving: 0, annualExpenses: 40000 }, 40);
    expect(years).toBeGreaterThan(9);
    expect(years).toBeLessThan(12);
  });

  it("returns null when it never coasts within the horizon", () => {
    expect(coastsBy({ investable: 1000, monthlySaving: 0, annualExpenses: 40000 }, 20)).toBeNull();
  });

  it("is already coasting when the pot is already the target", () => {
    expect(coastsBy({ investable: 1000000, monthlySaving: 0, annualExpenses: 40000 }, 40)).toBe(0);
  });
});
