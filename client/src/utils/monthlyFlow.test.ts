import { describe, expect, it } from "vitest";
import { monthlyFlow, type FlowKind } from "./monthlyFlow.js";

const KINDS: Record<number, FlowKind> = {
  1: { countsAsIncome: true, isTransfer: false }, // Salary
  2: { countsAsIncome: true, isTransfer: false }, // Bonus (occasional is still income here)
  3: { countsAsIncome: false, isTransfer: false }, // Transport
  4: { countsAsIncome: false, isTransfer: false }, // Groceries
  5: { countsAsIncome: false, isTransfer: true }, // Transfers
};

const kind = (id: number | null): FlowKind | null => (id == null ? null : (KINDS[id] ?? null));

const tx = (amount: number, category_id: number | null = null) => ({ amount, category_id });

/** The common case: one list, no loan repayments in it. */
const flowOf = (rows: ReturnType<typeof tx>[]) => monthlyFlow({ flow: rows, spending: rows }, kind);

describe("monthlyFlow", () => {
  it("totals declared income and spending separately", () => {
    expect(flowOf([tx(3000, 1), tx(-500, 3), tx(-200, 4)])).toEqual({
      income: 3000,
      otherIn: 0,
      expenses: 700,
      saved: 2300,
    });
  });

  /**
   * The correction this file exists for. Every credit used to count as
   * income, which reported a household earning money from its own bus fares
   * and divided the savings rate by a denominator containing its own refunds.
   */
  it("does not call a refund income", () => {
    const flow = flowOf([tx(3000, 1), tx(-500, 3), tx(40, 3)]);
    expect(flow.income).toBe(3000);
    expect(flow.otherIn).toBe(0);
    // Transport cost €40 less, which is what happened.
    expect(flow.expenses).toBe(460);
  });

  /**
   * The reason the netting is not optional. Taking the €40 off the income
   * side and leaving it on the spending side would report a household €40
   * worse off than it is — a wrong figure in place of a wrong label.
   */
  it("leaves what was saved exactly as it was", () => {
    const rows = [tx(3000, 1), tx(-500, 3), tx(40, 3), tx(-200, 4), tx(75, null)];
    const flow = flowOf(rows);
    const credits = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const debits = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    expect(flow.saved).toBeCloseTo(credits - debits, 10);
    expect(flow.income + flow.otherIn - flow.expenses).toBeCloseTo(flow.saved, 10);
  });

  // A bonus is income and a card saying what came in this month would be
  // wrong to leave one out. Only the forecast narrows it further.
  it("counts occasional income as income", () => {
    expect(flowOf([tx(2000, 1), tx(500, 2)]).income).toBe(2500);
  });

  /**
   * "Uncategorised" is the absence of a relationship, not a relationship.
   * Netting one unknown credit against unrelated unknown spending would be
   * inventing the connection.
   */
  it("does not net an unfiled credit against unfiled spending", () => {
    const flow = flowOf([tx(800, null), tx(-200, null)]);
    expect(flow).toEqual({ income: 0, otherIn: 800, expenses: 200, saved: 600 });
  });

  it("puts a credit in a category it has never heard of under other money in", () => {
    expect(flowOf([tx(120, 99)]).otherIn).toBe(120);
  });

  /**
   * A category that took back more than it ever spent still has to show the
   * difference somewhere, or the card stops reconciling against the bank —
   * just never under the heading "income".
   */
  it("reports an over-large refund as other money in, not as income", () => {
    const flow = flowOf([tx(1000, 1), tx(-100, 3), tx(300, 3)]);
    expect(flow.income).toBe(1000);
    expect(flow.otherIn).toBe(200);
    expect(flow.expenses).toBe(0);
    expect(flow.saved).toBe(1200);
  });

  it("reports a refund with no spending behind it as other money in", () => {
    const flow = flowOf([tx(50, 4)]);
    expect(flow).toEqual({ income: 0, otherIn: 50, expenses: 0, saved: 50 });
  });

  // Should already be gone upstream; skipped here as well so a caller that
  // forgets cannot turn its own savings into a month of better earnings.
  it("ignores a transfer in", () => {
    expect(flowOf([tx(2000, 1), tx(500, 5)]).income).toBe(2000);
  });

  /**
   * The two lists are deliberately different. A loan repayment leaves the
   * account and is not money spent, so it is out of `spending` — and the
   * credits still come off the full list, so none of them can be lost.
   */
  it("keeps a loan repayment out of spending while keeping every credit", () => {
    const flow = [tx(3000, 1), tx(-400, 4), tx(-170, null)];
    const spending = [tx(3000, 1), tx(-400, 4)];
    expect(monthlyFlow({ flow, spending }, kind)).toEqual({
      income: 3000,
      otherIn: 0,
      expenses: 400,
      saved: 2600,
    });
  });

  /**
   * Nothing flagged is a setup state, not a month with no income. The figure
   * is reported honestly — none of it is called income — and the card says
   * which of the two it is in words.
   */
  it("calls nothing income when no category is marked as income", () => {
    const none = (): FlowKind | null => ({ countsAsIncome: false, isTransfer: false });
    expect(monthlyFlow({ flow: [tx(3000, 1), tx(-500, 3)], spending: [tx(3000, 1), tx(-500, 3)] }, none)).toEqual({
      income: 0,
      otherIn: 3000,
      expenses: 500,
      saved: 2500,
    });
  });

  it("copes with a period that had nothing in it", () => {
    expect(flowOf([])).toEqual({ income: 0, otherIn: 0, expenses: 0, saved: 0 });
  });
});
