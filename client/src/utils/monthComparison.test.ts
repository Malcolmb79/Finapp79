import { describe, expect, it } from "vitest";
import { compareMonths, dayOfMonth, monthKey, previousMonth } from "./monthComparison.js";

/**
 * The failure that matters is flattering. A part-finished month set against a
 * finished one shows every category falling, every month, until the last day —
 * an improvement that is only the calendar. Somebody reading that would
 * conclude they had spent less when they had not.
 */

const spend = (date: string, amount: number, category: number | null) => ({
  amount: -amount,
  booking_date: date,
  category_id: category,
});

const names: Record<number, string> = { 1: "Groceries", 2: "Eating out" };
const categoryName = (id: number | null) => (id == null ? null : (names[id] ?? null));

describe("monthKey / previousMonth / dayOfMonth", () => {
  it("reads the parts of a date", () => {
    expect(monthKey("2026-11-11")).toBe("2026-11");
    expect(dayOfMonth("2026-11-11")).toBe(11);
    expect(previousMonth("2026-11-11")).toBe("2026-10");
  });

  it("steps back over a year boundary", () => {
    expect(previousMonth("2026-01-05")).toBe("2025-12");
  });
});

describe("compareMonths", () => {
  /**
   * The point of the whole module. Eleven days of this month against the
   * first eleven of last, not against all thirty-one.
   */
  it("compares the same stretch of last month", () => {
    const transactions = [
      spend("2026-11-05", 100, 1),
      // Last month, inside the same stretch.
      spend("2026-10-05", 80, 1),
      // Last month, but later than today's day-of-month — excluded, because
      // this month has not reached it yet.
      spend("2026-10-25", 500, 1),
    ];
    const result = compareMonths(transactions, categoryName, "2026-11-11");
    expect(result.now).toBe(100);
    expect(result.before).toBe(80);
    expect(result.delta).toBe(20);
    expect(result.days).toBe(11);
  });

  // Stated plainly, because the figures are to date and a reader has to know.
  it("says the month is still running", () => {
    expect(compareMonths([], categoryName, "2026-11-11").partial).toBe(true);
    expect(compareMonths([], categoryName, "2026-11-11", true).partial).toBe(false);
  });

  it("compares a finished month whole", () => {
    const transactions = [spend("2026-10-25", 500, 1)];
    const whole = compareMonths(transactions, categoryName, "2026-11-11", true);
    expect(whole.before).toBe(500);
  });

  it("breaks the change down by category", () => {
    const transactions = [spend("2026-11-02", 150, 1), spend("2026-10-02", 90, 1), spend("2026-11-03", 40, 2)];
    const result = compareMonths(transactions, categoryName, "2026-11-10");
    const groceries = result.rows.find((r) => r.label === "Groceries")!;
    expect(groceries).toMatchObject({ now: 150, before: 90, delta: 60 });
    expect(result.rows.find((r) => r.label === "Eating out")).toMatchObject({ now: 40, before: 0, delta: 40 });
  });

  // What changed is the question, and a category that fell answers it as well
  // as one that rose.
  it("puts the biggest movement first, in either direction", () => {
    const transactions = [spend("2026-11-02", 10, 1), spend("2026-10-02", 210, 1), spend("2026-11-02", 50, 2)];
    const result = compareMonths(transactions, categoryName, "2026-11-10");
    expect(result.rows[0].label).toBe("Groceries");
    expect(result.rows[0].delta).toBe(-200);
  });

  // A bonus read as a month of restraint is exactly the wrong conclusion.
  it("ignores money coming in", () => {
    const transactions = [{ amount: 3000, booking_date: "2026-11-02", category_id: 1 }, spend("2026-11-02", 25, 1)];
    expect(compareMonths(transactions, categoryName, "2026-11-10").now).toBe(25);
  });

  it("gives uncategorised spending its own row", () => {
    const result = compareMonths([spend("2026-11-02", 25, null)], categoryName, "2026-11-10");
    expect(result.rows[0].label).toBe("Uncategorised");
  });

  it("ignores months either side of the two being compared", () => {
    const transactions = [spend("2026-09-02", 999, 1), spend("2026-11-02", 10, 1)];
    const result = compareMonths(transactions, categoryName, "2026-11-10");
    expect(result.before).toBe(0);
    expect(result.now).toBe(10);
  });

  it("copes with a month that had nothing in it", () => {
    expect(compareMonths([], categoryName, "2026-11-10")).toMatchObject({ rows: [], now: 0, before: 0, delta: 0 });
  });
});
