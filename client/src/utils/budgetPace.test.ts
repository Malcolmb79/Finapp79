import { describe, expect, it } from "vitest";
import { budgetPace } from "./budgetPace.js";

/**
 * This fires in a notification bell, so the failure that matters is the false
 * alarm: a warning on every category every month is a bell nobody reads, and
 * the real one then goes unseen with it. Most of what follows is about when
 * to stay quiet.
 */

const on = (day: number) => new Date(2026, 10, day); // November 2026, 30 days

describe("budgetPace", () => {
  it("carries spending so far across the rest of the month", () => {
    // 100 over ten days of thirty is 300 by the end.
    expect(budgetPace(100, 500, on(10))?.projected).toBe(300);
  });

  it("warns when the pace points well past the limit", () => {
    const pace = budgetPace(100, 150, on(10));
    expect(pace?.projected).toBe(300);
    expect(pace?.worthSaying).toBe(true);
  });

  // The ordinary state of a budget. A warning here would fire on most
  // categories most months, and the bell stops meaning anything.
  it("stays quiet about a pace a little over the line", () => {
    expect(budgetPace(100, 290, on(10))?.worthSaying).toBe(false);
  });

  it("stays quiet about a pace inside the limit", () => {
    expect(budgetPace(100, 400, on(10))?.worthSaying).toBe(false);
  });

  /**
   * One supermarket run on the 2nd projects to fifteen times itself. That is
   * arithmetic, not information, and saying it teaches somebody to ignore the
   * bell by the 3rd.
   */
  it("says nothing in the first days of the month", () => {
    expect(budgetPace(100, 150, on(2))?.worthSaying).toBe(false);
    expect(budgetPace(100, 150, on(5))?.worthSaying).toBe(false);
    expect(budgetPace(100, 150, on(6))?.worthSaying).toBe(true);
  });

  // The existing over-budget alert already covers this, and two warnings
  // about one category is how a bell gets ignored.
  it("leaves a category that is already over to the alert that exists", () => {
    const pace = budgetPace(200, 150, on(10));
    expect(pace?.projected).toBe(600);
    expect(pace?.worthSaying).toBe(false);
  });

  // On the last day the projection is just what was spent, and there is no
  // month left to act in.
  it("says nothing on the last day of the month", () => {
    expect(budgetPace(100, 150, on(30))?.worthSaying).toBe(false);
  });

  it("handles a short month", () => {
    // February 2027: 28 days, 100 spent by the 14th is 200 by the end.
    expect(budgetPace(100, 500, new Date(2027, 1, 14))?.projected).toBe(200);
  });

  it("has nothing to say without a limit or without spending", () => {
    expect(budgetPace(100, 0, on(10))).toBeNull();
    expect(budgetPace(0, 500, on(10))).toBeNull();
    expect(budgetPace(-50, 500, on(10))).toBeNull();
  });
});
