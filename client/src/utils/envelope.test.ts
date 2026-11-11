import { describe, expect, it } from "vitest";
import { envelopePlan, type Assignments } from "./envelope.js";

/**
 * The figure this produces is the one somebody decides on — whether there is
 * enough in the clothes envelope to buy a coat. Wrong in the generous
 * direction it causes an overdraft; wrong in the mean direction it stops
 * somebody spending money they have. Both matter, which is why the carried
 * balance is tested in both directions.
 */

const categories = [
  { id: 1, name: "Groceries" },
  { id: 2, name: "Clothes" },
];

const spend = (date: string, amount: number, category: number | null) => ({
  amount: -amount,
  booking_date: date,
  category_id: category,
});

const income = (date: string, amount: number) => ({ amount, booking_date: date, category_id: null });

const assign = (entries: [string, number, number][]): Assignments => {
  const map: Assignments = new Map();
  for (const [month, category, amount] of entries) {
    const forMonth = map.get(month) ?? new Map<number, number>();
    forMonth.set(category, amount);
    map.set(month, forMonth);
  }
  return map;
};

const find = (plan: ReturnType<typeof envelopePlan>, id: number) => plan.categories.find((c) => c.categoryId === id)!;

describe("envelopePlan", () => {
  it("takes what was spent out of what was put in", () => {
    const plan = envelopePlan([spend("2026-11-04", 120, 1)], assign([["2026-11", 1, 400]]), categories, "2026-11");
    expect(find(plan, 1)).toMatchObject({ carried: 0, assigned: 400, spent: 120, available: 280 });
  });

  /**
   * The whole point, and what a monthly cap cannot do. Two quiet months on
   * clothes mean there is money there for a coat in the third.
   */
  it("carries what is left into the next month", () => {
    const assignments = assign([
      ["2026-09", 2, 50],
      ["2026-10", 2, 50],
      ["2026-11", 2, 50],
    ]);
    const plan = envelopePlan([spend("2026-09-10", 10, 2)], assignments, categories, "2026-11");
    // 50 − 10 = 40 carried, then 40 + 50 = 90, then 90 + 50 = 140.
    expect(find(plan, 2)).toMatchObject({ carried: 90, assigned: 50, available: 140 });
  });

  /**
   * The uncomfortable half. Resetting an overspent category to zero would let
   * it be overspent every month forever while each month looked survivable.
   */
  it("carries an overspend as a debt against next month", () => {
    const assignments = assign([
      ["2026-10", 1, 100],
      ["2026-11", 1, 100],
    ]);
    const plan = envelopePlan([spend("2026-10-15", 140, 1)], assignments, categories, "2026-11");
    expect(find(plan, 1)).toMatchObject({ carried: -40, assigned: 100, available: 60 });
  });

  // A refund is the category's own money coming home, not new income.
  it("puts a refund back in the envelope", () => {
    const plan = envelopePlan(
      [spend("2026-11-04", 120, 1), { amount: 20, booking_date: "2026-11-06", category_id: 1 }],
      assign([["2026-11", 1, 400]]),
      categories,
      "2026-11"
    );
    expect(find(plan, 1)).toMatchObject({ spent: 100, available: 300 });
  });

  it("leaves a category nobody has funded at zero", () => {
    const plan = envelopePlan([], new Map(), categories, "2026-11");
    expect(find(plan, 2)).toMatchObject({ carried: 0, assigned: 0, spent: 0, available: 0 });
  });

  // Zero-based budgeting's headline: what has not been given a job yet.
  it("reports income that has not been assigned", () => {
    const plan = envelopePlan([income("2026-11-01", 3000)], assign([["2026-11", 1, 400], ["2026-11", 2, 100]]), categories, "2026-11");
    expect(plan).toMatchObject({ income: 3000, assigned: 500, unassigned: 2500 });
  });

  // Allowed, because it may be funded by what was carried in — but worth
  // seeing rather than hidden.
  it("reports assigning more than came in", () => {
    const plan = envelopePlan([income("2026-11-01", 100)], assign([["2026-11", 1, 400]]), categories, "2026-11");
    expect(plan.unassigned).toBe(-300);
  });

  it("ignores months after the one being looked at", () => {
    const plan = envelopePlan(
      [spend("2026-12-04", 999, 1)],
      assign([["2026-11", 1, 400], ["2026-12", 1, 400]]),
      categories,
      "2026-11"
    );
    expect(find(plan, 1)).toMatchObject({ spent: 0, available: 400 });
  });

  it("ignores spending with no category", () => {
    const plan = envelopePlan([spend("2026-11-04", 50, null)], assign([["2026-11", 1, 400]]), categories, "2026-11");
    expect(find(plan, 1).spent).toBe(0);
  });

  // Money is whole cents; floating point drift is not a figure.
  it("keeps the arithmetic in cents", () => {
    const plan = envelopePlan(
      [spend("2026-11-01", 0.1, 1), spend("2026-11-02", 0.2, 1)],
      assign([["2026-11", 1, 1]]),
      categories,
      "2026-11"
    );
    expect(find(plan, 1).available).toBe(0.7);
  });

  it("copes with no history at all", () => {
    const plan = envelopePlan([], new Map(), categories, "2026-11");
    expect(plan).toMatchObject({ income: 0, assigned: 0, unassigned: 0 });
    expect(plan.categories).toHaveLength(2);
  });

  // A transaction mis-dated far in the past must not walk a thousand months.
  it("does not run away on a wildly mis-dated transaction", () => {
    const plan = envelopePlan([spend("1900-01-01", 5, 1)], assign([["2026-11", 1, 20]]), categories, "2026-11");
    expect(plan.categories).toHaveLength(2);
  });
});
