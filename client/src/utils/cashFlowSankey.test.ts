import { describe, expect, it } from "vitest";
import { cashFlow } from "./cashFlowSankey.js";

/**
 * The bands have to add up to the totals printed beside them. A picture whose
 * widths tell a different story from the figures is worse than no picture:
 * the whole point of the shape is that proportion can be read off it without
 * doing arithmetic, so a band that is quietly the wrong width is believed.
 */

const tx = (amount: number, category: number | null, description = "Something") => ({
  amount,
  description,
  counterparty: null,
  category_id: category,
});

const names: Record<number, string> = { 1: "Rent", 2: "Groceries", 3: "Salary" };
const categoryName = (id: number | null) => (id == null ? null : (names[id] ?? null));

describe("cashFlow", () => {
  it("splits a month into where it came from and where it went", () => {
    const flow = cashFlow([tx(3000, 3), tx(-1200, 1), tx(-400, 2)], categoryName);
    expect(flow.totalIn).toBe(3000);
    expect(flow.totalOut).toBe(1600);
    expect(flow.surplus).toBe(1400);
    expect(flow.sources.map((s) => s.label)).toEqual(["Salary"]);
  });

  // Half the reason to look at a month. Without it the right-hand side is
  // lighter than the left with nothing saying why.
  it("shows what was left over as a destination", () => {
    const flow = cashFlow([tx(3000, 3), tx(-1200, 1)], categoryName);
    const left = flow.destinations.find((d) => d.key === "__surplus");
    expect(left?.amount).toBe(1800);
  });

  // A month funded from savings has nothing left; inventing a band would
  // claim otherwise.
  it("shows nothing left over when more went out than came in", () => {
    const flow = cashFlow([tx(1000, 3), tx(-1500, 1)], categoryName);
    expect(flow.surplus).toBe(-500);
    expect(flow.destinations.some((d) => d.key === "__surplus")).toBe(false);
  });

  /**
   * Money that went somewhere unnamed is still money that went somewhere.
   * Hiding it would leave the picture not adding up to the figure beside it.
   */
  it("gives uncategorised spending a band of its own", () => {
    const flow = cashFlow([tx(500, 3), tx(-100, null)], categoryName);
    expect(flow.destinations.find((d) => d.label === "Uncategorised")?.amount).toBe(100);
  });

  it("adds several transactions in one category into one band", () => {
    const flow = cashFlow([tx(1000, 3), tx(-30, 2), tx(-70, 2)], categoryName);
    expect(flow.destinations.find((d) => d.label === "Groceries")?.amount).toBe(100);
  });

  /**
   * The long tail is grouped, never dropped: the bands still have to total
   * what was spent.
   */
  it("groups the slivers without losing them", () => {
    // Thirty distinct categories of a pound each, against five hundred of
    // rent — each one far under the share worth drawing on its own.
    const named = (id: number | null) => (id != null && id >= 100 ? `Thing ${id}` : categoryName(id));
    const tiny = Array.from({ length: 30 }, (_, i) => tx(-1, 100 + i));
    const flow = cashFlow([tx(1000, 3), tx(-500, 1), ...tiny], named);

    const spent = flow.destinations.filter((d) => d.key !== "__surplus").reduce((sum, d) => sum + d.amount, 0);
    expect(spent).toBeCloseTo(530, 5);
    expect(flow.destinations.some((d) => d.key === "__rest")).toBe(true);
    // Readable rather than a comb of thirty one-pixel bands.
    expect(flow.destinations.length).toBeLessThanOrEqual(10);
  });

  it("names income by its source when it has no category", () => {
    const flow = cashFlow([{ amount: 2000, description: "ACME PAYROLL", counterparty: null, category_id: null }], categoryName);
    expect(flow.sources[0].label).toBe("ACME PAYROLL");
  });

  it("copes with a period that had nothing in it", () => {
    const flow = cashFlow([], categoryName);
    expect(flow).toMatchObject({ sources: [], destinations: [], totalIn: 0, totalOut: 0, surplus: 0 });
  });
});
