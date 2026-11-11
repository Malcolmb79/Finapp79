import { describe, expect, it } from "vitest";
import { combine, duration } from "./debtTimeline.js";

/**
 * The whole point of the combined chart is the date it names, so the failure
 * that matters is naming the wrong one. Two in particular:
 *
 * An account's series stops at the month it clears. Treated as missing data
 * rather than as nothing owed, a short series would drag the total's end
 * forward and promise a debt-free date earlier than the truth.
 *
 * And a balance amortised to zero rarely lands exactly on it, so a total that
 * visibly reaches the axis has to be read as clear rather than as a fraction
 * of a penny still outstanding.
 */

describe("combine", () => {
  it("adds the debts month by month", () => {
    const { total } = combine([
      [300, 200, 100, 0],
      [100, 50, 0],
    ]);
    expect(total).toEqual([400, 250, 100, 0]);
  });

  // The one that would quietly lie. The shorter debt cleared in month 2; the
  // total must still carry the longer one to its own end.
  it("treats a finished debt as nothing owed, not as missing", () => {
    const { total, clearsAt } = combine([
      [300, 200, 100, 50, 0],
      [100, 0],
    ]);
    expect(total).toEqual([400, 200, 100, 50, 0]);
    expect(clearsAt).toBe(4);
  });

  it("names the first month the total reaches zero", () => {
    expect(combine([[100, 50, 0, 0]]).clearsAt).toBe(2);
  });

  // Amortisation leaves fractions of a penny behind. A line that touches the
  // axis should say the debt is gone.
  it("counts a fraction of a penny as clear", () => {
    expect(combine([[100, 0.004]]).clearsAt).toBe(1);
    expect(combine([[100, 0.02]]).clearsAt).toBeNull();
  });

  it("says nothing rather than guessing when the debt never clears", () => {
    expect(combine([[500, 500, 500]]).clearsAt).toBeNull();
  });

  it("copes with nothing selected", () => {
    expect(combine([])).toEqual({ total: [], clearsAt: null });
  });
});

describe("duration", () => {
  it("reads the way a person would say it", () => {
    expect(duration(1)).toBe("1 month");
    expect(duration(7)).toBe("7 months");
    expect(duration(12)).toBe("1 year");
    expect(duration(18)).toBe("1 year 6 mo");
    expect(duration(24)).toBe("2 years");
  });

  it("has words for the two cases that are not a count", () => {
    expect(duration(0)).toBe("already clear");
    expect(duration(null)).toBe("not within the horizon");
  });
});
