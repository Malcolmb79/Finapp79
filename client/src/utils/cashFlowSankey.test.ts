import { describe, expect, it } from "vitest";
import { cashFlow, type FlowCategory } from "./cashFlowSankey.js";

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

const CATEGORIES: Record<number, FlowCategory> = {
  1: { name: "Rent", countsAsIncome: false, isTransfer: false },
  2: { name: "Groceries", countsAsIncome: false, isTransfer: false },
  3: { name: "Salary", countsAsIncome: true, isTransfer: false },
  4: { name: "Transfer In", countsAsIncome: false, isTransfer: true },
  5: { name: "Transport", countsAsIncome: false, isTransfer: false },
};

const category = (id: number | null): FlowCategory | null => (id == null ? null : (CATEGORIES[id] ?? null));

describe("cashFlow", () => {
  it("splits a month into where it came from and where it went", () => {
    const flow = cashFlow([tx(3000, 3), tx(-1200, 1), tx(-400, 2)], category);
    expect(flow.totalIn).toBe(3000);
    expect(flow.totalOut).toBe(1600);
    expect(flow.surplus).toBe(1400);
    expect(flow.sources.map((s) => s.label)).toEqual(["Salary"]);
  });

  /**
   * The correction this file exists for. Every credit used to become a source
   * named after its category, which put "Transport" and "Miscellaneous" on
   * the income side — a household does not earn money from its own bus fares.
   * Income is the declared thing, and a refund belongs against the thing it
   * came back from.
   */
  it("never shows a category that is not income as a source of income", () => {
    const flow = cashFlow([tx(3000, 3), tx(-500, 5), tx(40, 5)], category);
    expect(flow.sources.map((s) => s.label)).toEqual(["Salary"]);
    expect(flow.destinations.find((d) => d.label === "Transport")?.amount).toBe(460);
    expect(flow.totalIn).toBe(3000);
    expect(flow.totalOut).toBe(460);
  });

  // Money out of savings genuinely is where some of a month's spending came
  // from, and the card names the shortfall "From savings" already.
  it("keeps a transfer in as a source of its own", () => {
    const flow = cashFlow([tx(3000, 3), tx(500, 4), tx(-1000, 1)], category);
    expect(flow.sources.map((s) => s.label).sort()).toEqual(["Salary", "Transfer In"]);
    expect(flow.totalIn).toBe(3500);
  });

  /**
   * A category that took back more than it ever spent still has to show the
   * difference somewhere, or the picture stops adding up — just never under
   * its own name on the income side.
   */
  it("moves an over-large refund to the left without naming its category", () => {
    const flow = cashFlow([tx(1000, 3), tx(-100, 5), tx(300, 5)], category);
    expect(flow.destinations.some((d) => d.label === "Transport")).toBe(false);
    expect(flow.sources.map((s) => s.label).sort()).toEqual(["Other money in", "Salary"]);
    expect(flow.sources.find((s) => s.label === "Other money in")?.amount).toBe(200);
    expect(flow.totalIn).toBe(1200);
  });

  /**
   * "Uncategorised" is the absence of a relationship, not a relationship.
   * Netting one unknown credit against unrelated unknown spending would be
   * inventing the connection, so it goes left under a name claiming nothing.
   */
  it("does not net an unfiled credit against unfiled spending", () => {
    const flow = cashFlow([tx(800, null), tx(-200, null)], category);
    expect(flow.sources.map((s) => s.label)).toEqual(["Other money in"]);
    expect(flow.destinations.find((d) => d.label === "Uncategorised")?.amount).toBe(200);
    expect(flow.totalIn).toBe(800);
    expect(flow.totalOut).toBe(200);
  });

  // Half the reason to look at a month. Without it the right-hand side is
  // lighter than the left with nothing saying why.
  it("shows what was left over as a destination", () => {
    const flow = cashFlow([tx(3000, 3), tx(-1200, 1)], category);
    expect(flow.destinations.find((d) => d.key === "__surplus")?.amount).toBe(1800);
  });

  // A month funded from savings has nothing left; inventing a band would
  // claim otherwise.
  it("shows nothing left over when more went out than came in", () => {
    const flow = cashFlow([tx(1000, 3), tx(-1500, 1)], category);
    expect(flow.surplus).toBe(-500);
    expect(flow.destinations.some((d) => d.key === "__surplus")).toBe(false);
  });

  /**
   * Money that went somewhere unnamed is still money that went somewhere.
   * Hiding it would leave the picture not adding up to the figure beside it.
   */
  it("gives uncategorised spending a band of its own", () => {
    const flow = cashFlow([tx(500, 3), tx(-100, null)], category);
    expect(flow.destinations.find((d) => d.label === "Uncategorised")?.amount).toBe(100);
  });

  it("adds several transactions in one category into one band", () => {
    const flow = cashFlow([tx(1000, 3), tx(-30, 2), tx(-70, 2)], category);
    expect(flow.destinations.find((d) => d.label === "Groceries")?.amount).toBe(100);
  });

  /**
   * The long tail is grouped, never dropped: the bands still have to total
   * what was spent.
   */
  it("groups the slivers without losing them", () => {
    // Thirty distinct categories of a pound each, against five hundred of
    // rent — each one far under the share worth drawing on its own.
    const many = (id: number | null): FlowCategory | null =>
      id != null && id >= 100 ? { name: `Thing ${id}`, countsAsIncome: false, isTransfer: false } : category(id);
    const tiny = Array.from({ length: 30 }, (_, i) => tx(-1, 100 + i));
    const flow = cashFlow([tx(1000, 3), tx(-500, 1), ...tiny], many);

    const spent = flow.destinations.filter((d) => d.key !== "__surplus").reduce((sum, d) => sum + d.amount, 0);
    expect(spent).toBeCloseTo(530, 5);
    expect(flow.destinations.some((d) => d.key === "__rest")).toBe(true);
    // Readable rather than a comb of thirty one-pixel bands.
    expect(flow.destinations.length).toBeLessThanOrEqual(10);
  });

  /**
   * The band is correct and, on its own, unusable: it says money arrived and
   * that nothing calls it income, which is the exact moment the reader asks
   * *what money*. Unanswered, that reads as a fault in the chart rather than
   * as a question about the data.
   */
  describe("what Other money in is made of", () => {
    it("counts the unfiled credits and names the payees behind them", () => {
      const flow = cashFlow(
        [tx(3000, 3, "Payroll"), tx(900, null, "ACME LTD"), tx(150, null, "Revolut top up"), tx(40, null, "ACME LTD 4471")],
        category
      );
      expect(flow.otherIn?.amount).toBe(1090);
      expect(flow.otherIn?.unfiled.count).toBe(3);
      // Grouped the way the subscription detector groups payees and listed
      // largest first, so one shop's receipt numbers do not become two names
      // in a sentence meant to be read at a glance.
      expect(flow.otherIn?.unfiled.payees).toEqual(["Acme Ltd", "Revolut top up"]);
    });

    /**
     * `merchantKey` strips digits, so a credit carrying a payment reference
     * is its own merchant — "Inward Swift R026J26" and "Inward Swift R026K7P"
     * do not group, by the same rule that stops the forecast reading one-off
     * credits as a salary. The count is still right, which is what the
     * sentence leans on; only the list of names is longer.
     */
    it("does not pretend two references are one payer", () => {
      const flow = cashFlow([tx(900, null, "INWARD SWIFT R026J26"), tx(40, null, "INWARD SWIFT R026K7P")], category);
      expect(flow.otherIn?.unfiled.count).toBe(2);
      expect(flow.otherIn?.unfiled.payees).toHaveLength(2);
    });

    // Three names is a sentence; ten is a list nobody reads, and the card
    // says "and others" rather than printing them.
    it("names no more than three payees", () => {
      const many = Array.from({ length: 6 }, (_, i) => tx(100 - i, null, `Payer ${String.fromCharCode(97 + i)}`));
      expect(cashFlow(many, category).otherIn?.unfiled.payees).toHaveLength(3);
    });

    // Named individually rather than totalled: a reader can go and check
    // "Transport took back more than it spent".
    it("names each category that took back more than it spent", () => {
      const flow = cashFlow([tx(1000, 3), tx(-100, 5), tx(300, 5)], category);
      expect(flow.otherIn?.overRefunded).toEqual([{ label: "Transport", amount: 200 }]);
      expect(flow.otherIn?.unfiled.count).toBe(0);
    });

    it("is null when every credit was declared income", () => {
      expect(cashFlow([tx(3000, 3), tx(-100, 5)], category).otherIn).toBeNull();
    });
  });

  it("copes with a period that had nothing in it", () => {
    const flow = cashFlow([], category);
    expect(flow).toMatchObject({ sources: [], destinations: [], totalIn: 0, totalOut: 0, surplus: 0 });
  });
});
