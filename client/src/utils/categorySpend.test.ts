import { describe, expect, it } from "vitest";
import { categorySpend } from "./categorySpend.js";
import type { FlowKind } from "./monthlyFlow.js";

const NAMES: Record<number, string> = { 1: "Salary", 2: "Transport", 3: "Groceries", 4: "Transfers" };
const name = (id: number | null) => (id == null ? "Uncategorized" : (NAMES[id] ?? "Unknown"));
const kind = (id: number | null): FlowKind | null =>
  id == null ? null : { countsAsIncome: id === 1, isTransfer: id === 4 };

const tx = (amount: number, category_id: number | null = null) => ({ amount, category_id });

describe("categorySpend", () => {
  it("totals what went out of each category, largest first", () => {
    const spend = categorySpend([tx(-500, 2), tx(-200, 3), tx(-100, 3)], name, kind);
    expect(spend.rows.map((r) => [r.name, r.total])).toEqual([
      ["Transport", 500],
      ["Groceries", 300],
    ]);
    expect(spend.total).toBe(800);
  });

  /**
   * The correction. A refund is money coming back to the thing it was spent
   * on — €40 back on transport means transport cost €460 — and totalling only
   * the debits put €500 of category spending above a €460 expenses headline
   * with nothing on the page saying why the two disagreed.
   */
  it("takes a refund off the category it came back to", () => {
    const spend = categorySpend([tx(-500, 2), tx(40, 2)], name, kind);
    expect(spend.rows[0]).toMatchObject({ name: "Transport", total: 460, refunded: 40, count: 1 });
    expect(spend.total).toBe(460);
  });

  // Netting in silence trades one invisible fact for another, so the screen
  // is given what it took away.
  it("reports what it netted off", () => {
    expect(categorySpend([tx(-500, 2), tx(40, 2), tx(-100, 3), tx(10, 3)], name, kind).refunded).toBe(50);
  });

  /**
   * "Uncategorised" is the absence of a relationship rather than a
   * relationship, so one unknown credit does not reduce unrelated unknown
   * spending — the same rule the flow chart lives under.
   */
  it("never nets an unfiled credit against unfiled spending", () => {
    const spend = categorySpend([tx(-200), tx(80)], name, kind);
    expect(spend.rows[0]).toMatchObject({ name: "Uncategorized", total: 200, refunded: 0 });
    expect(spend.refunded).toBe(0);
  });

  // A salary is not a refund of anything, and a category of income has no
  // business reducing what was spent.
  it("does not treat income as a refund", () => {
    const spend = categorySpend([tx(-300, 3), tx(2000, 1)], name, kind);
    expect(spend.rows).toHaveLength(1);
    expect(spend.rows[0]).toMatchObject({ name: "Groceries", total: 300 });
  });

  it("leaves transfers out of spending entirely", () => {
    expect(categorySpend([tx(-300, 3), tx(-2000, 4)], name, kind).total).toBe(300);
  });

  /**
   * Drawn as a bar this is negative, and a chart of magnitudes has no honest
   * way to show that — so it is named rather than drawn, and never as a
   * category that cost nothing.
   */
  it("names a category that took back more than it spent instead of drawing it", () => {
    const spend = categorySpend([tx(-100, 2), tx(300, 2), tx(-50, 3)], name, kind);
    expect(spend.rows.map((r) => r.name)).toEqual(["Groceries"]);
    expect(spend.overRefunded).toEqual([{ name: "Transport", amount: 200 }]);
    // Only what it actually took off a total counts as netted.
    expect(spend.refunded).toBe(100);
  });

  it("copes with nothing at all", () => {
    expect(categorySpend([], name, kind)).toEqual({ rows: [], total: 0, refunded: 0, overRefunded: [] });
  });

  // The id comes back so a chart drawn from names can still link to the
  // category it is naming.
  it("carries the category id back with the name", () => {
    expect(categorySpend([tx(-10, 2), tx(-5)], name, kind).rows.map((r) => r.categoryId)).toEqual([2, null]);
  });
});

/**
 * A category that only ever receives did not "take back" anything — it never
 * spent anything to take back. "Salary took back €2,184 more than it spent"
 * is a sentence about a refund that did not happen, and it appeared the
 * moment this ran on a household with nothing flagged as income.
 *
 * Those credits are income, or money nothing calls income; either way that is
 * `monthlyFlow`'s question. A spend-by-category chart has nothing to say
 * about them.
 */
describe("a category that only receives", () => {
  it("is not reported as having over-refunded", () => {
    const spend = categorySpend([tx(-300, 3), tx(2184, 2)], name, () => null);
    expect(spend.overRefunded).toEqual([]);
    expect(spend.rows.map((r) => r.name)).toEqual(["Groceries"]);
    expect(spend.refunded).toBe(0);
  });

  // The genuine case still is: it spent, and more came back than went out.
  it("still names one that spent and then took more back", () => {
    const spend = categorySpend([tx(-100, 2), tx(300, 2)], name, () => null);
    expect(spend.overRefunded).toEqual([{ name: "Transport", amount: 200 }]);
  });
});
