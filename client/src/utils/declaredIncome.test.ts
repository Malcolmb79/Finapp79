import { describe, expect, it } from "vitest";
import { declaredIncome, forecastBalance } from "./forecast.js";

/**
 * Income found by pattern needs three matching credits before it is believed.
 * Someone who has just started a job, changed employer, or is paid from more
 * than one place therefore gets a projection whose line only ever falls —
 * which reads as a household running out of money every month. Saying which
 * category the pay goes into is the way to be believed on day one, and this
 * is what reads that.
 */

const credit = (date: string, amount: number, description: string, category: number | null) => ({
  amount,
  booking_date: date,
  description,
  counterparty: null,
  category_id: category,
});

/** Category 1 is the one marked as regular income. */
const isIncome = (id: number | null | undefined) => id === 1;

describe("declaredIncome", () => {
  // The whole point: one payment is enough when it has been pointed at.
  it("believes a single payment that was declared", () => {
    const found = declaredIncome([credit("2026-10-30", 2800, "ACME PAYROLL", 1)], isIncome);
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(2800);
    expect(found[0].lastCharged).toBe("2026-10-30");
    // The only guess here, made because projecting nothing from a salary
    // somebody pointed at is worse than assuming the commonest pay cycle.
    expect(found[0].cadence).toBe("monthly");
  });

  it("measures the cycle once there are two payments to measure", () => {
    const fortnightly = declaredIncome(
      [credit("2026-10-02", 900, "ACME PAYROLL", 1), credit("2026-10-16", 900, "ACME PAYROLL", 1)],
      isIncome
    );
    // Fortnightly has no cadence of its own, and rounds to weekly rather than
    // monthly: projected monthly, half the money that actually arrives would
    // never appear.
    expect(fortnightly[0].cadence).toBe("weekly");

    const monthly = declaredIncome(
      [credit("2026-09-28", 2800, "ACME PAYROLL", 1), credit("2026-10-28", 2800, "ACME PAYROLL", 1)],
      isIncome
    );
    expect(monthly[0].cadence).toBe("monthly");
  });

  // A raise should show next month, not be diluted by the year before it.
  it("takes the most recent payment, not the average", () => {
    const found = declaredIncome(
      [credit("2026-08-28", 2000, "ACME PAYROLL", 1), credit("2026-09-28", 2000, "ACME PAYROLL", 1), credit("2026-10-28", 3000, "ACME PAYROLL", 1)],
      isIncome
    );
    expect(found[0].amount).toBe(3000);
  });

  // Two jobs are two incomes. Averaged into one they would match neither.
  it("keeps two sources apart", () => {
    const found = declaredIncome(
      [credit("2026-10-28", 2000, "ACME PAYROLL", 1), credit("2026-10-15", 600, "SIDE WORK LTD", 1)],
      isIncome
    );
    expect(found).toHaveLength(2);
  });

  it("ignores anything not filed as income", () => {
    expect(declaredIncome([credit("2026-10-28", 2800, "ACME PAYROLL", 2)], isIncome)).toEqual([]);
  });

  // Money out is not income however it is filed.
  it("ignores outgoings in an income category", () => {
    expect(declaredIncome([credit("2026-10-28", -50, "REFUND BACK", 1)], isIncome)).toEqual([]);
  });
});

describe("forecastBalance with a declared income", () => {
  const rent = [
    { amount: -1000, booking_date: "2026-08-03", description: "RENT", counterparty: null, category_id: 2 },
    { amount: -1000, booking_date: "2026-09-03", description: "RENT", counterparty: null, category_id: 2 },
    { amount: -1000, booking_date: "2026-10-03", description: "RENT", counterparty: null, category_id: 2 },
    { amount: -1000, booking_date: "2026-11-03", description: "RENT", counterparty: null, category_id: 2 },
  ];

  /**
   * The failure this exists to prevent: one month into a new job, detection
   * sees one credit and reports no income at all.
   */
  it("counts on a salary detection would not yet believe", () => {
    const newJob = [...rent, credit("2026-11-01", 2500, "NEW EMPLOYER", 1)];

    const without = forecastBalance(newJob, 1000, { from: "2026-11-10", days: 60 });
    expect(without.incomeFound).toBe(false);

    const withDeclared = forecastBalance(newJob, 1000, { from: "2026-11-10", days: 60, isIncomeCategory: isIncome });
    expect(withDeclared.incomeFound).toBe(true);
    // The declared salary lands inside the horizon, so the line rises.
    expect(withDeclared.low!.balance).toBeGreaterThan(without.low!.balance);
  });

  // Marking one category as income is not a claim that nothing else is.
  it("keeps income detection found as well", () => {
    const salary = ["2026-08-25", "2026-09-25", "2026-10-25"].map((d) => credit(d, 3000, "OLD EMPLOYER", null));
    const forecast = forecastBalance([...rent, ...salary], 1000, {
      from: "2026-11-10",
      days: 60,
      isIncomeCategory: isIncome,
    });
    expect(forecast.incomeFound).toBe(true);
  });
});
