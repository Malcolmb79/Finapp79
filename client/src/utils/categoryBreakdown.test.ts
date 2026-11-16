import { describe, expect, it } from "vitest";
import { categoryBreakdown, type CategoryTransaction } from "./categoryBreakdown.js";

const tx = (over: Partial<CategoryTransaction> = {}): CategoryTransaction => ({
  amount: -20,
  booking_date: "2026-09-02",
  description: "TESCO STORES 3288",
  counterparty: null,
  category_id: 1,
  ...over,
});

describe("categoryBreakdown", () => {
  it("counts only the category asked for", () => {
    const found = categoryBreakdown([tx(), tx({ category_id: 2, amount: -500 })], 1);
    expect(found.total).toBe(20);
    expect(found.count).toBe(1);
  });

  /**
   * The failure this whole breakdown exists to avoid. Store numbers differ on
   * every receipt, so without grouping the way the subscription detector does
   * the payee list is forty rows of the same shop and says nothing.
   */
  it("groups one shop's many store numbers into one payee", () => {
    const found = categoryBreakdown(
      [tx({ description: "TESCO STORES 3288" }), tx({ description: "TESCO STORES 4471" }), tx({ description: "LIDL" })],
      1
    );
    expect(found.payees).toHaveLength(2);
    expect(found.payees[0]).toMatchObject({ total: 40, count: 2 });
  });

  /**
   * A refund is not negative spending. Netting one against the month's
   * shopping reports a cheaper month than happened and hides both facts.
   */
  it("keeps money coming back out of the spending total", () => {
    const found = categoryBreakdown([tx({ amount: -100 }), tx({ amount: 30 })], 1);
    expect(found.total).toBe(100);
    expect(found.refunds).toBe(30);
    expect(found.refundCount).toBe(1);
    expect(found.count).toBe(1);
  });

  /**
   * Divided by the months with spending in them, not the length of the
   * window: a category used twice a year averaged over twelve months reports
   * a figure true of no month it ever happened in.
   */
  it("averages over the months it was actually used", () => {
    const found = categoryBreakdown(
      [tx({ booking_date: "2026-03-01", amount: -300 }), tx({ booking_date: "2026-09-01", amount: -300 })],
      1
    );
    expect(found.monthlyAverage).toBe(300);
    expect(found.months.map((m) => m.month)).toEqual(["2026-03", "2026-09"]);
  });

  /**
   * The pair that says which shape the category has. Four big shops and forty
   * small ones reach the same total and want opposite answers, and only the
   * middle payment beside the largest distinguishes them.
   */
  it("reports the middle payment beside the largest", () => {
    const found = categoryBreakdown([tx({ amount: -5 }), tx({ amount: -10 }), tx({ amount: -400 })], 1);
    expect(found.typical).toBe(10);
    expect(found.largest).toBe(400);
  });

  it("puts the months in order and the payees by size", () => {
    const found = categoryBreakdown(
      [
        tx({ booking_date: "2026-09-02", description: "LIDL", amount: -10 }),
        tx({ booking_date: "2026-07-02", description: "TESCO", amount: -90 }),
      ],
      1
    );
    expect(found.months.map((m) => m.month)).toEqual(["2026-07", "2026-09"]);
    expect(found.payees.map((p) => p.label)).toEqual(["Tesco", "Lidl"]);
  });

  it("says nothing rather than dividing by zero on an empty category", () => {
    const found = categoryBreakdown([], 1);
    expect(found).toMatchObject({ total: 0, count: 0, monthlyAverage: 0, typical: 0, largest: 0 });
    expect(found.months).toEqual([]);
  });
});
