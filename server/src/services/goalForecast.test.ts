import { describe, expect, it } from "vitest";
import { forecastGoal } from "./goalForecast.js";

/**
 * This date is one somebody plans a move around. Wrong in the optimistic
 * direction it has them give notice on a flat before the money is there;
 * wrong in the pessimistic direction it has them keep renting for a year
 * longer than they needed to. The two mistakes that produced both of those
 * when the sums were done by hand - a flat surplus, and a pot spent to zero -
 * each have a test here.
 */

const NOW = new Date("2026-11-15T00:00:00Z");

describe("forecastGoal", () => {
  it("divides the gap by what goes in each month", () => {
    const f = forecastGoal({ target: 10000, current: 0, surplusNow: 1000 }, NOW);
    expect(f.months).toBe(10);
    expect(f.reachedIn).toBe("2027-09");
  });

  it("says so when the target is already met", () => {
    const f = forecastGoal({ target: 10000, current: 12000, surplusNow: 500 }, NOW);
    expect(f.months).toBe(0);
  });

  /**
   * The mistake that cost nine months by hand. A debt finishing hands its
   * payment back, so the amount saved steps up; projecting at today's figure
   * is projecting at the lowest figure there will ever be.
   */
  it("speeds up as debts clear and hand their payments back", () => {
    const flat = forecastGoal({ target: 24000, current: 0, surplusNow: 1000 }, NOW);
    const stepped = forecastGoal(
      {
        target: 24000,
        current: 0,
        surplusNow: 1000,
        freed: [
          { name: "Card", monthlyPayment: 500, monthCleared: 6 },
          { name: "Loan", monthlyPayment: 500, monthCleared: 12 },
        ],
      },
      NOW
    );
    // Six months at 1,000, six at 1,500 once the card goes, then 2,000 once
    // the loan does: 24,000 in seventeen months instead of twenty-four.
    expect(flat.months).toBe(24);
    expect(stepped.months).toBeLessThan(flat.months!);
    expect(stepped.months).toBe(17);
  });

  it("names each debt that freed money, and what was going in after it", () => {
    const f = forecastGoal(
      {
        target: 24000,
        current: 0,
        surplusNow: 1000,
        freed: [{ name: "Card", monthlyPayment: 500, monthCleared: 6 }],
      },
      NOW
    );
    expect(f.milestones).toEqual([{ month: 7, name: "Card", savingAfter: 1500 }]);
  });

  /**
   * The second mistake. A pot that is also the emergency fund cannot be handed
   * over in full, so the buffer is part of what has to be saved.
   */
  it("saves the buffer as well as the target", () => {
    const without = forecastGoal({ target: 10000, current: 0, surplusNow: 1000 }, NOW);
    const withBuffer = forecastGoal({ target: 10000, current: 0, surplusNow: 1000, buffer: 3000 }, NOW);
    expect(without.months).toBe(10);
    expect(withBuffer.months).toBe(13);
    expect(withBuffer.effectiveTarget).toBe(13000);
  });

  it("takes the unplanned out as it goes", () => {
    const f = forecastGoal({ target: 12000, current: 0, surplusNow: 1000, drawPerYear: 2400 }, NOW);
    // 1,000 in and 200 out leaves 800 a month.
    expect(f.months).toBe(15);
  });

  it("sets the pot back by a one-off withdrawal", () => {
    // Taken in month four, when there is 4,000 there to take it from.
    const f = forecastGoal(
      { target: 10000, current: 0, surplusNow: 1000, oneOff: { monthsFromNow: 4, amount: 3000 } },
      NOW
    );
    expect(f.months).toBe(13);
  });

  /**
   * A one-off bigger than the pot empties it rather than taking it negative,
   * which means the shortfall - money that has to come from somewhere else -
   * is not carried in this projection. Stated here because it makes the date
   * optimistic in that case, and somebody reading the forecast should know
   * which way it errs.
   */
  it("empties the pot rather than overdrawing it", () => {
    const f = forecastGoal(
      { target: 10000, current: 0, surplusNow: 1000, oneOff: { monthsFromNow: 2, amount: 3000 } },
      NOW
    );
    expect(f.potByMonth[2]).toBe(0);
    expect(f.months).toBe(12);
  });

  it("saves only the share that really reaches the pot", () => {
    const f = forecastGoal({ target: 10000, current: 0, surplusNow: 1000, share: 0.5 }, NOW);
    expect(f.months).toBe(20);
  });

  // A projection that cannot happen has to say so rather than return a date
  // fifty years out as though it were a plan.
  it("refuses to project a pot that never grows", () => {
    const f = forecastGoal({ target: 10000, current: 0, surplusNow: 0 }, NOW);
    expect(f.months).toBeNull();
    expect(f.reason).toMatch(/never grows/);
  });

  it("refuses when the unplanned outruns the saving", () => {
    const f = forecastGoal({ target: 10000, current: 0, surplusNow: 100, drawPerYear: 2400 }, NOW);
    expect(f.months).toBeNull();
  });

  /**
   * A deficit is funded by borrowing, not by a savings pot that has nothing
   * in it. Letting the pot go negative drew a savings curve of money nobody
   * had, and then climbed out of a hole that was never dug.
   */
  it("never lets the pot go below empty, and counts the months instead", () => {
    const f = forecastGoal(
      {
        target: 1000,
        current: 0,
        surplusNow: -100,
        freed: [{ name: "Card", monthlyPayment: 600, monthCleared: 6 }],
      },
      NOW
    );
    expect(Math.min(...f.potByMonth)).toBe(0);
    expect(f.deficitMonths).toBe(6);
    // Five hundred a month once the card goes, from an empty pot rather than
    // from six hundred in the red.
    expect(f.months).toBe(8);
  });

  it("reports no deficit months when every month saves something", () => {
    expect(forecastGoal({ target: 1000, current: 0, surplusNow: 500 }, NOW).deficitMonths).toBe(0);
  });

  it("keeps the curve, starting at what is already saved", () => {
    const f = forecastGoal({ target: 3000, current: 500, surplusNow: 1000 }, NOW);
    expect(f.potByMonth[0]).toBe(500);
    expect(f.potByMonth[1]).toBe(1500);
    expect(f.months).toBe(3);
  });
});
