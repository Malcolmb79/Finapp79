import { describe, expect, it } from "vitest";
import { shade, spendingCalendar } from "./spendingCalendar.js";

const spend = (date: string, amount: number) => ({ amount: -amount, booking_date: date });

/**
 * A calendar whose days land in the wrong columns is worse than no calendar:
 * the pattern people look for here is weekly, so a day in the wrong column
 * invents a pattern rather than showing one.
 */
describe("spendingCalendar", () => {
  it("lays a month out as whole weeks", () => {
    const { weeks } = spendingCalendar([], "2026-11");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });

  // 1 November 2026 is a Sunday, which with Monday first is the last column —
  // the case that catches an off-by-one in the week start.
  it("puts the first of the month in its real column", () => {
    const { weeks } = spendingCalendar([], "2026-11");
    const firstRow = weeks[0];
    expect(firstRow.slice(0, 6).every((d) => !d.inMonth)).toBe(true);
    expect(firstRow[6].date).toBe("2026-11-01");
  });

  it("knows how long each month is", () => {
    expect(spendingCalendar([], "2026-02").weeks.flat().filter((d) => d.inMonth)).toHaveLength(28);
    // 2028 is a leap year, worked out from the next month rather than a rule.
    expect(spendingCalendar([], "2028-02").weeks.flat().filter((d) => d.inMonth)).toHaveLength(29);
    expect(spendingCalendar([], "2026-12").weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("adds up a day's spending", () => {
    const calendar = spendingCalendar([spend("2026-11-03", 10), spend("2026-11-03", 15), spend("2026-11-04", 5)], "2026-11");
    const third = calendar.weeks.flat().find((d) => d.date === "2026-11-03");
    expect(third?.amount).toBe(25);
    expect(calendar.total).toBe(30);
  });

  it("names the heaviest day rather than leaving it to be hunted", () => {
    const calendar = spendingCalendar([spend("2026-11-03", 10), spend("2026-11-20", 400)], "2026-11");
    expect(calendar.busiest?.date).toBe("2026-11-20");
    expect(calendar.peak).toBe(400);
  });

  it("ignores money coming in and other months", () => {
    const calendar = spendingCalendar(
      [{ amount: 2000, booking_date: "2026-11-02" }, spend("2026-10-02", 50), spend("2026-11-02", 30)],
      "2026-11"
    );
    expect(calendar.total).toBe(30);
  });

  it("copes with a month that had nothing in it", () => {
    const calendar = spendingCalendar([], "2026-11");
    expect(calendar).toMatchObject({ total: 0, peak: 0, busiest: null });
  });
});

describe("shade", () => {
  it("is darkest on the heaviest day and blank on an empty one", () => {
    expect(shade(100, 100)).toBe(1);
    expect(shade(0, 100)).toBe(0);
  });

  /**
   * The reason it is not linear. One rent payment otherwise sets the scale and
   * leaves every ordinary day at the palest shade — hiding the everyday
   * pattern behind the one exception, which is the opposite of the point.
   */
  it("keeps an ordinary day visible beside one huge one", () => {
    const linear = 20 / 1000;
    expect(shade(20, 1000)).toBeGreaterThan(linear * 3);
  });

  it("says nothing when there is nothing to scale against", () => {
    expect(shade(50, 0)).toBe(0);
  });
});
