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
    const dates = nextDueDates({ cadence: "weekly", lastCharged: "2026-11-18" }, "2026-11-20", "2026-12-01");
    expect(dates.every((date) => date >= "2026-11-20")).toBe(true);
    expect(dates.length).toBeGreaterThan(0);
  });

  /**
   * A commitment last charged a year ago is finished, not due next month.
   *
   * Skipping the dates that have been and gone made this *look* handled: a
   * credit received once in January 2025 produced no 2025 dates, so nothing
   * seemed wrong — and then produced next month's, and the month after,
   * indefinitely. Harmless on a cancelled subscription, where it only makes
   * the line pessimistic. On the income side it is how a household with a
   * dozen old one-off credits gets shown a balance climbing by a dozen
   * salaries a month.
   */
  it("drops a commitment that has missed its turn rather than projecting it forever", () => {
    expect(nextDueDates({ cadence: "monthly", lastCharged: "2025-01-05" }, "2026-11-10", "2026-12-10")).toEqual([]);
  });

  // Half a cycle of slack, so a salary paid on the 25th and a statement
  // imported a fortnight late are both still believed.
  it("allows a cycle and a half before giving up on one", () => {
    expect(nextDueDates({ cadence: "monthly", lastCharged: "2026-10-10" }, "2026-11-10", "2026-12-20")).toHaveLength(1);
    expect(nextDueDates({ cadence: "monthly", lastCharged: "2026-09-10" }, "2026-11-10", "2026-12-20")).toEqual([]);
  });

  // A yearly bill is not overdue at six months, and the slack has to scale
  // with the rhythm or every annual commitment disappears.
  it("judges each cadence against its own rhythm", () => {
    expect(nextDueDates({ cadence: "yearly", lastCharged: "2026-05-10" }, "2026-11-10", "2027-06-10")).toHaveLength(1);
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

/**
 * The failure this guards against was on screen: a balance of -€2,975 today
 * projected to +€89,601 in sixty days, off an account whose real income is a
 * fraction of that.
 *
 * Every piece of it was working as written. Credits whose description carries
 * a payment reference never group into one merchant — "Inward Swift
 * R026J26Md0" and "Inward Swift R026K7Pb60" are two merchants as far as
 * `merchantKey` is concerned — so each arrives as a merchant with exactly one
 * payment. A merchant with one payment has no spacing to measure, so the
 * cadence defaults to monthly. And `nextDueDates` happily stepped forward
 * from a date two years back. One credit, received once, became a salary.
 */
describe("a credit that happened once", () => {
  const oneOff = (label: string, date: string) => [{ amount: 1500, booking_date: date, description: label, counterparty: null }];

  const swifts = [
    ...oneOff("Inward Swift R026J26Md0 Malcolm David Barske", "2026-04-20"),
    ...oneOff("Inward Swift R026K7Pb60 Malcolm Barske", "2026-07-19"),
    ...oneOff("Inward Swift R026Hj6220 Malcolm David Barske", "2026-01-20"),
  ];
  const income = (id: number | null | undefined) => id === 1;
  const categorised = swifts.map((tx) => ({ ...tx, category_id: 1 }));

  it("is not a salary, however it was categorised", () => {
    const forecast = forecastBalance(categorised, -2975.89, { from: "2026-11-16", days: 60, isIncomeCategory: income });
    expect(forecast.incomes).toBe(0);
    expect(forecast.points[forecast.points.length - 1].balance).toBeCloseTo(-2975.89);
  });

  // The one the default exists for, and it still works: a job started last
  // month, declared as income, is projected from its single payment rather
  // than leaving a line that only ever falls.
  it("still projects a recent one, which is what the default is for", () => {
    const justStarted = [{ amount: 3000, booking_date: "2026-11-01", description: "ACME PAYROLL", counterparty: null, category_id: 1 }];
    const forecast = forecastBalance(justStarted, 0, { from: "2026-11-16", days: 60, isIncomeCategory: income });
    expect(forecast.incomes).toBe(1);
    expect(forecast.monthlyIncome).toBeCloseTo(3000);
  });

  /**
   * Money moving between your own accounts is not money arriving. The line
   * opens at every spendable account added together, so both legs are already
   * inside the opening figure — counting the inflow adds money that was
   * always there, monthly, forever.
   */
  it("ignores a transfer in when the caller says which list income comes from", () => {
    const transfers = monthly("TRANSFER FROM SAVINGS", 2000, ["2026-09-16", "2026-10-16", "2026-11-16"]);
    const withTransfers = forecastBalance(transfers, 0, { from: "2026-11-16", days: 60 });
    expect(withTransfers.incomes).toBe(1);

    const without = forecastBalance(transfers, 0, { from: "2026-11-16", days: 60, incomeFrom: [] });
    expect(without.incomes).toBe(0);
    expect(without.points[without.points.length - 1].balance).toBeCloseTo(0);
  });

  // What was missing from the card: a projection built on twelve invented
  // salaries looked exactly like one built on a real salary.
  it("says how many incomes it is counting on and what they come to", () => {
    const salary = monthly("SALARY", 3000, ["2026-09-25", "2026-10-25", "2026-11-25"]);
    const forecast = forecastBalance(salary, 0, { from: "2026-11-26", days: 60 });
    expect(forecast.incomes).toBe(1);
    expect(forecast.monthlyIncome).toBeCloseTo(3000);
  });
});
