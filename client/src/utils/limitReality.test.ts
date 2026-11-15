import { describe, expect, it } from "vitest";
import type { Budget, Category, Transaction } from "../api/client.js";
import { completeMonths, defensibleLimit, gradeLimit, limitNote, limitReality, type LimitCheck } from "./limitReality.js";

/**
 * The case this exists for is a real one: a takeaway limit of 50 against 222
 * actually spent, reported every month as an overspend. The overspend is not
 * the news. The cap is.
 */

const money = (value: number) => `€${value.toFixed(0)}`;

describe("completeMonths", () => {
  it("gives the six months before this one, oldest first", () => {
    expect(completeMonths(new Date("2026-11-15T00:00:00Z"))).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  // The month on screen is unfinished. Counted as a whole one it drags every
  // figure down and makes every cap look generous.
  it("leaves out the month being lived in", () => {
    expect(completeMonths(new Date("2026-11-01T00:00:00Z"))).not.toContain("2026-11");
  });

  it("crosses a year boundary", () => {
    expect(completeMonths(new Date("2026-02-10T00:00:00Z"))).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

describe("gradeLimit", () => {
  const steady = [210, 230, 222, 240, 205, 225];

  it("calls a cap beaten every month by a wide margin fiction", () => {
    const graded = gradeLimit(steady, 50);
    expect(graded.verdict).toBe("too-tight");
    expect(graded.monthsOver).toBe(6);
    expect(graded.typical).toBeCloseTo(223.5, 1);
    // And offers something livable rather than only an accusation.
    expect(graded.suggested).toBeGreaterThan(220);
  });

  /**
   * Beaten every single month counts even when the margin is small. A limit
   * breached six times out of six restrains nothing, whether by a quarter or
   * by a fiver.
   */
  it("calls a cap beaten in every month too tight even by a little", () => {
    expect(gradeLimit([101, 102, 103, 104, 105, 106], 100).verdict).toBe("too-tight");
  });

  it("leaves a cap that mostly holds alone", () => {
    const graded = gradeLimit([210, 230, 222, 240, 205, 225], 240);
    expect(graded.verdict).toBe("about-right");
    expect(graded.monthsOver).toBe(0);
    // Nothing to improve on, so nothing is offered — a figure beside a
    // healthy cap only invites fiddling.
    expect(graded.suggested).toBeNull();
  });

  it("still calls a cap that bites occasionally about right", () => {
    const graded = gradeLimit([210, 230, 222, 240, 205, 225], 225);
    expect(graded.verdict).toBe("about-right");
    expect(graded.monthsOver).toBeGreaterThan(0);
  });

  it("calls a cap the worst month never came near slack", () => {
    const graded = gradeLimit([40, 55, 48, 60, 35, 50], 500);
    expect(graded.verdict).toBe("too-loose");
    expect(graded.highest).toBe(60);
    expect(graded.suggested).toBeLessThan(100);
  });

  /**
   * Measured against the highest month rather than the typical one. A category
   * bought in two months of six has a typical month of nothing and a real
   * spike, and calling that slack would be wrong.
   */
  it("does not call a spiky category slack because most months are empty", () => {
    const graded = gradeLimit([0, 0, 0, 180, 0, 170], 200);
    expect(graded.typical).toBe(0);
    expect(graded.verdict).not.toBe("too-loose");
  });

  it("says so rather than guessing when there is barely any history", () => {
    const graded = gradeLimit([0, 0, 0, 0, 40, 45], 50);
    expect(graded.verdict).toBe("unproven");
    expect(graded.monthsActive).toBe(2);
    expect(graded.suggested).toBeNull();
  });

  it("marks a category being spent on with no cap", () => {
    expect(gradeLimit([210, 230, 222, 240, 205, 225], null).verdict).toBe("unbudgeted");
  });

  // A cap with nothing spent against it at all. It is not a breach and it is
  // not working either — it is a line holding a place.
  it("treats an untouched cap as unproven, not as working", () => {
    const graded = gradeLimit([0, 0, 0, 0, 0, 0], 13250);
    expect(graded.verdict).toBe("unproven");
    expect(graded.monthsActive).toBe(0);
  });
});

describe("defensibleLimit", () => {
  it("sits above a steady category rather than on top of it", () => {
    const limit = defensibleLimit([210, 230, 222, 240, 205, 225]);
    expect(limit).toBeGreaterThan(223);
    expect(limit).toBeLessThan(260);
  });

  /**
   * A category bought twice in six months has a typical month of nothing, and
   * a cap of nothing guarantees a breach the month it comes round. The mean
   * spreads it across the months instead.
   */
  it("spreads an occasional cost across the months rather than capping it at zero", () => {
    expect(defensibleLimit([0, 0, 0, 180, 0, 170])).toBeGreaterThan(50);
  });

  it("is zero for nothing", () => {
    expect(defensibleLimit([])).toBe(0);
  });
});

describe("limitReality", () => {
  const now = new Date("2026-11-15T00:00:00Z");
  const categories: Category[] = [
    { id: 1, name: "Takeaway & Delivery" },
    { id: 2, name: "Groceries" },
    { id: 3, name: "Income" },
  ] as Category[];

  function tx(partial: Partial<Transaction>): Transaction {
    return {
      id: Math.random().toString(36),
      account_id: "a1",
      category_id: 1,
      booking_date: "2026-10-04",
      amount: -40,
      currency: "EUR",
      description: null,
      counterparty: null,
      source: "manual",
      reviewed_at: "2026-10-05",
      ...partial,
    } as Transaction;
  }

  const sixMonths = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const takeaway = sixMonths.map((m) => tx({ booking_date: `${m}-04`, category_id: 1, amount: -222 }));

  const budget = (over: Partial<Budget>): Budget =>
    ({ id: 1, category_id: 1, category_name: "Takeaway & Delivery", monthly_limit: 50, spent: 0, currency: "EUR", ...over }) as Budget;

  it("finds the cap nobody believes", () => {
    const [check] = limitReality([budget({})], takeaway, categories, "EUR", now);
    expect(check.category_name).toBe("Takeaway & Delivery");
    expect(check.verdict).toBe("too-tight");
    expect(check.monthsOver).toBe(6);
  });

  // Only reviewed rows, matching what GET /api/budgets counts as spent. Two
  // figures for the same category on the same page is worse than one.
  it("ignores transactions that have not been reviewed", () => {
    const unreviewed = takeaway.map((t) => ({ ...t, reviewed_at: null }));
    const [check] = limitReality([budget({})], unreviewed, categories, "EUR", now);
    expect(check.monthsActive).toBe(0);
  });

  it("ignores another currency's spending entirely", () => {
    const sterling = takeaway.map((t) => ({ ...t, currency: "GBP" }));
    const [check] = limitReality([budget({})], sterling, categories, "EUR", now);
    expect(check.monthsActive).toBe(0);
  });

  it("ignores another currency's caps", () => {
    expect(limitReality([budget({ currency: "GBP" })], [], categories, "EUR", now)).toEqual([]);
  });

  it("leaves out the month being lived in", () => {
    const thisMonth = [...takeaway, tx({ booking_date: "2026-11-02", amount: -900 })];
    const [check] = limitReality([budget({})], thisMonth, categories, "EUR", now);
    expect(check.highest).toBe(222);
  });

  it("reads a split transaction as its parts", () => {
    const split = tx({
      booking_date: "2026-10-09",
      amount: -100,
      category_id: 1,
      splits: [
        { category_id: 1, amount: -30 },
        { category_id: 2, amount: -70 },
      ],
    });
    const checks = limitReality(
      [budget({ id: 2, category_id: 2, category_name: "Groceries", monthly_limit: 400 })],
      [split, ...takeaway],
      categories,
      "EUR",
      now
    );
    // Thirty against takeaway and seventy against groceries, not a hundred
    // against either — the same reading GET /api/budgets does, or the two
    // screens would disagree about one payment.
    expect(checks.find((c) => c.category_name === "Groceries")?.highest).toBe(70);
    expect(checks.find((c) => c.category_name === "Takeaway & Delivery")?.highest).toBe(252);
  });

  it("surfaces a category being spent on with no cap at all", () => {
    const check = limitReality([], takeaway, categories, "EUR", now)[0];
    expect(check.verdict).toBe("unbudgeted");
    expect(check.limit).toBeNull();
    expect(check.suggested).toBeGreaterThan(220);
  });

  // Saying so for every stray fiver would bury the rows that matter.
  it("says nothing about an uncapped category with next to nothing in it", () => {
    const trivial = [tx({ booking_date: "2026-09-01", category_id: 2, amount: -6 })];
    expect(limitReality([], trivial, categories, "EUR", now)).toEqual([]);
  });

  it("ignores money coming in, and anything uncategorised", () => {
    const noise = [
      tx({ booking_date: "2026-09-01", category_id: 3, amount: 4200 }),
      tx({ booking_date: "2026-09-02", category_id: null, amount: -300 }),
    ];
    expect(limitReality([], noise, categories, "EUR", now)).toEqual([]);
  });

  /**
   * A cap on a category only money comes into — the "Income budget of 13,250"
   * case. Nothing is ever spent against it, so it reports as never touched
   * rather than as a budget being kept to beautifully.
   */
  it("reports a cap on an income category as untouched", () => {
    const incomeCap = budget({ id: 2, category_id: 3, category_name: "Income", monthly_limit: 13250 });
    const [check] = limitReality([incomeCap], [tx({ category_id: 3, amount: 4200 })], categories, "EUR", now);
    expect(check.verdict).toBe("unproven");
    expect(check.monthsActive).toBe(0);
  });

  it("puts the caps that are wrong first, and the biggest money first within that", () => {
    const small = sixMonths.map((m) => tx({ booking_date: `${m}-06`, category_id: 2, amount: -60 }));
    const checks = limitReality(
      [budget({}), budget({ id: 2, category_id: 2, category_name: "Groceries", monthly_limit: 300 })],
      [...takeaway, ...small],
      categories,
      "EUR",
      now
    );
    expect(checks.map((c) => c.verdict)).toEqual(["too-tight", "too-loose"]);
  });
});

describe("limitNote", () => {
  const base: LimitCheck = {
    category_id: 1,
    category_name: "Takeaway & Delivery",
    limit: 50,
    months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) => ({ month, amount: 222 })),
    typical: 222,
    mean: 222,
    monthly: 222,
    highest: 222,
    monthsOver: 6,
    monthsActive: 6,
    verdict: "too-tight",
    suggested: 240,
  };

  // The verdict on its own is an opinion. The count is what makes it checkable.
  it("counts the months, so the verdict can be disagreed with", () => {
    const note = limitNote(base, money);
    expect(note).toContain("6 of the last 6 months");
    expect(note).toContain("€50");
    expect(note).toContain("€240");
  });

  it("says what dropping a slack cap frees up", () => {
    const note = limitNote(
      { ...base, limit: 500, typical: 48, highest: 60, monthsOver: 0, verdict: "too-loose", suggested: 70 },
      money
    );
    expect(note).toContain("€60");
    expect(note).toContain("frees €430");
  });

  it("names a category with no cap and what one would cost", () => {
    expect(limitNote({ ...base, limit: null, verdict: "unbudgeted" }, money)).toContain("No limit set");
  });

  /**
   * The figure that read as nonsense on screen: a category bought twice in six
   * months has a typical month of nothing, so "nothing typically goes out, and
   * 76 would cover it" put two contradicting figures on one line.
   */
  it("does not claim nothing goes out of a category bought occasionally", () => {
    const occasional = limitNote(
      { ...base, limit: null, verdict: "unbudgeted", typical: 0, mean: 51, monthly: 51, highest: 165, monthsActive: 2, suggested: 76 },
      money
    );
    expect(occasional).not.toContain("€0");
    expect(occasional).toContain("2 of the last 6 months");
    expect(occasional).toContain("€165");
  });

  it("says how often a cap came round when it did not come round every month", () => {
    const note = limitNote({ ...base, typical: 0, mean: 51, monthly: 51, monthsOver: 0, monthsActive: 2, verdict: "about-right" }, money);
    expect(note).toContain("2 of the last 6");
    expect(note).toContain("Working");
  });

  it("distinguishes a cap never touched from one too new to judge", () => {
    expect(limitNote({ ...base, monthsActive: 0, verdict: "unproven" }, money)).toContain("Nothing has gone out");
    expect(limitNote({ ...base, monthsActive: 2, verdict: "unproven" }, money)).toContain("2 months of spending");
  });

  it("says plainly when a cap is working", () => {
    expect(limitNote({ ...base, monthsOver: 0, verdict: "about-right" }, money)).toContain("Working");
    expect(limitNote({ ...base, monthsOver: 2, verdict: "about-right" }, money)).toContain("doing its job");
  });
});
