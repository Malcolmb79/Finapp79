import { describe, expect, it } from "vitest";
import { rangeMonthCount, rangeStart, withinRange } from "./dateRange.js";

const NOW = new Date("2026-07-31T12:00:00Z");

describe("rangeStart", () => {
  it("takes the calendar month for 'this month', not thirty days", () => {
    expect(rangeStart("month", NOW)).toBe("2026-07-01");
  });

  it("rolls back by days for the day ranges", () => {
    expect(rangeStart("30", NOW)).toBe("2026-07-01");
    expect(rangeStart("60", NOW)).toBe("2026-06-01");
    expect(rangeStart("90", NOW)).toBe("2026-05-02");
  });

  it("treats a year as 365 days", () => {
    expect(rangeStart("year", NOW)).toBe("2025-07-31");
  });

  it("has no start for all time", () => {
    expect(rangeStart("all", NOW)).toBeNull();
  });

  // On the 3rd, "this month" means three days and "last 30 days" means five
  // weeks. They only coincide at the end of a 30-day month.
  it("separates 'this month' from 'last 30 days' early in a month", () => {
    const early = new Date("2026-07-03T12:00:00Z");
    expect(rangeStart("month", early)).toBe("2026-07-01");
    expect(rangeStart("30", early)).toBe("2026-06-03");
  });
});

describe("withinRange", () => {
  const txs = [
    { booking_date: "2026-07-30", amount: -1 },
    { booking_date: "2026-07-02", amount: -2 },
    { booking_date: "2026-06-15", amount: -3 },
    { booking_date: "2024-01-01", amount: -4 },
  ];

  it("keeps only what falls inside the window", () => {
    expect(withinRange(txs, "month", NOW).map((t) => t.amount)).toEqual([-1, -2]);
  });

  it("includes a transaction booked exactly on the boundary", () => {
    expect(withinRange([{ booking_date: "2026-07-01" }], "month", NOW)).toHaveLength(1);
  });

  it("returns everything, and the same array, for all time", () => {
    expect(withinRange(txs, "all", NOW)).toBe(txs);
  });
});

describe("rangeMonthCount", () => {
  it("covers a day range with whole month buckets", () => {
    expect(rangeMonthCount("30")).toBe(1);
    expect(rangeMonthCount("60")).toBe(2);
    expect(rangeMonthCount("90")).toBe(3);
  });

  it("maps the named ranges", () => {
    expect(rangeMonthCount("month")).toBe(1);
    expect(rangeMonthCount("year")).toBe(12);
    expect(rangeMonthCount("all")).toBeNull();
  });

  // Rounding up rather than down: a bucket cut short drops real spending off
  // the end of a bar, which reads as a quiet month rather than a clipped one.
  it("never rounds a partial month down to nothing", () => {
    expect(rangeMonthCount("30")).toBeGreaterThan(0);
  });
});
