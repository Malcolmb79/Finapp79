import { describe, expect, it } from "vitest";
import { forecastBalance, nextDueDates, upcomingBills } from "./forecast.js";

/** A run of charges on the same day each month, oldest first. */
function monthly(label: string, amount: number, months: string[]) {
  return months.map((date) => ({ amount, booking_date: date, description: label, counterparty: null }));
}

describe("nextDueDates", () => {
  // Stepping from the last charge rather than from today is what keeps the
  // day of the month right — "every 30.4 days from now" drifts off the 3rd
  // within two months.
  it("counts forward from the last charge", () => {
    const dates = nextDueDates({ cadence: "monthly", lastCharged: "2026-11-03" }, "2026-11-10", "2027-01-20");
    expect(dates).toEqual(["2026-12-03", "2027-01-02"]);
  });

  it("leaves out dates already past", () => {
    const dates = nextDueDates({ cadence: "weekly", lastCharged: "2026-11-01" }, "2026-11-20", "2026-12-01");
    expect(dates.every((date) => date >= "2026-11-20")).toBe(true);
    expect(dates.length).toBeGreaterThan(0);
  });

  // A commitment last charged a year ago is finished or overdue, not a run of
  // twelve dates that have been and gone.
  it("catches up to the present rather than replaying history", () => {
    const dates = nextDueDates({ cadence: "monthly", lastCharged: "2025-01-05" }, "2026-11-10", "2026-12-10");
    expect(dates).toHaveLength(1);
  });

  it("stops at the horizon", () => {
    expect(nextDueDates({ cadence: "monthly", lastCharged: "2026-11-03" }, "2026-11-10", "2026-11-15")).toEqual([]);
  });
});

describe("upcomingBills", () => {
  const rent = monthly("RENT", -1200, ["2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"]);
  const gym = monthly("GYM", -40, ["2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"]);

  it("lists what is due, soonest first", () => {
    const bills = upcomingBills([...rent, ...gym], { from: "2026-11-16", until: "2026-12-31" });
    expect(bills.map((b) => [b.label, b.dueDate])).toEqual([
      // Title-cased by cleanDescription, which is what a bank's shouting
      // becomes on screen — see utils/cleanDescription.ts.
      ["Rent", "2026-12-03"],
      ["Gym", "2026-12-15"],
    ]);
  });

  // Three charges is what detectRecurring will vouch for. A bill predicted
  // from one past payment is a guess dressed up as a commitment.
  it("says nothing about a merchant seen twice", () => {
    const twice = monthly("ONCE OFF", -500, ["2026-10-02", "2026-11-02"]);
    expect(upcomingBills(twice, { from: "2026-11-10", until: "2026-12-31" })).toEqual([]);
  });

  it("ignores money coming in", () => {
    const salary = monthly("SALARY", 3000, ["2026-08-25", "2026-09-25", "2026-10-25", "2026-11-25"]);
    expect(upcomingBills(salary, { from: "2026-11-26", until: "2026-12-31" })).toEqual([]);
  });
});

/**
 * The question this whole view exists to answer is "will there be enough
 * before payday", so the figure that matters is the low point — and the
 * failure that matters is a forecast that misses the salary and shows a
 * household running out of money every month.
 */
describe("forecastBalance", () => {
  const rent = monthly("RENT", -1200, ["2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"]);
  const salary = monthly("SALARY", 3000, ["2026-08-25", "2026-09-25", "2026-10-25", "2026-11-25"]);

  it("takes outgoings off and puts income on", () => {
    const forecast = forecastBalance([...rent, ...salary], 2000, { from: "2026-11-26", days: 35 });
    // 35 days reaches 31 Dec: rent on 3 Dec takes it to 800, salary on the
    // 25th brings it to 3800, and January rent falls outside the horizon.
    expect(forecast.points[forecast.points.length - 1].balance).toBeCloseTo(3800);
    expect(forecast.incomeFound).toBe(true);
    expect(forecast.commitments).toBe(1);
  });

  it("names the day it is at its worst", () => {
    const forecast = forecastBalance([...rent, ...salary], 2000, { from: "2026-11-26", days: 35 });
    expect(forecast.low?.balance).toBeCloseTo(800);
    expect(forecast.low?.date).toBe("2026-12-03");
  });

  // Reported rather than patched: a line that only ever falls is the honest
  // output when no regular income was found, and saying so is what stops it
  // being read as a prediction of ruin.
  it("says when it found no regular income", () => {
    const forecast = forecastBalance(rent, 2000, { from: "2026-11-26", days: 35 });
    expect(forecast.incomeFound).toBe(false);
    expect(forecast.low?.balance).toBeCloseTo(800);
  });

  it("starts from the balance it was given", () => {
    const forecast = forecastBalance([], 1234.56, { from: "2026-11-26", days: 5 });
    expect(forecast.points[0].balance).toBeCloseTo(1234.56);
    expect(forecast.points).toHaveLength(6);
    expect(forecast.commitments).toBe(0);
  });
});
