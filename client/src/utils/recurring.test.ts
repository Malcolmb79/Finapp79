import { describe, expect, it } from "vitest";
import { detectRecurring, merchantKey } from "./recurring.js";

const charge = (description: string, amount: number, booking_date: string) => ({
  amount,
  booking_date,
  description,
  counterparty: null,
});

/** Twelve monthly charges of the same amount, starting from a given month. */
function monthly(description: string, amount: number, months: number, startMonth = 1) {
  return Array.from({ length: months }, (_, i) => {
    const month = String(startMonth + i).padStart(2, "0");
    return charge(description, -amount, `2026-${month}-14`);
  });
}

describe("merchantKey", () => {
  // The same shop with a different till reference is one merchant; treating
  // the reference as part of the name hides every pattern behind it.
  it("ignores the reference numbers that differ between charges", () => {
    expect(merchantKey(charge("TESCO STORES 3288", -12, "2026-01-01"))).toBe(
      merchantKey(charge("TESCO STORES 4471", -12, "2026-02-01"))
    );
  });

  it("keeps different merchants apart", () => {
    expect(merchantKey(charge("NETFLIX.COM", -9.99, "2026-01-01"))).not.toBe(
      merchantKey(charge("SPOTIFY UK", -9.99, "2026-01-01"))
    );
  });

  it("falls back to the counterparty when there is no description", () => {
    expect(merchantKey({ amount: -5, booking_date: "2026-01-01", description: null, counterparty: "Gym" })).toBe("gym");
  });
});

describe("detectRecurring", () => {
  it("finds a monthly subscription and annualises it", () => {
    const found = detectRecurring(monthly("NETFLIX.COM", 9.99, 6));
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe("monthly");
    expect(found[0].amount).toBeCloseTo(9.99, 2);
    expect(found[0].annualised).toBeCloseTo(119.88, 2);
  });

  it("tolerates the billing date drifting across the month", () => {
    // Real billing lands on working days, so the gap is never exactly 30.
    const found = detectRecurring([
      charge("SPOTIFY", -11.99, "2026-01-03"),
      charge("SPOTIFY", -11.99, "2026-02-02"),
      charge("SPOTIFY", -11.99, "2026-03-04"),
      charge("SPOTIFY", -11.99, "2026-04-01"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe("monthly");
  });

  it("accepts a price rise but not a different sum every time", () => {
    const risen = detectRecurring([
      charge("GYM", -30, "2026-01-05"),
      charge("GYM", -30, "2026-02-05"),
      charge("GYM", -33, "2026-03-05"),
    ]);
    expect(risen).toHaveLength(1);

    // A shop visited monthly for whatever the basket costs is not a
    // subscription, and calling it one would put a made-up annual figure
    // against it.
    const shop = detectRecurring([
      charge("TESCO", -12, "2026-01-05"),
      charge("TESCO", -47, "2026-02-05"),
      charge("TESCO", -103, "2026-03-05"),
    ]);
    expect(shop).toEqual([]);
  });

  it("needs three charges before calling anything a rhythm", () => {
    expect(detectRecurring(monthly("NETFLIX", 9.99, 2))).toEqual([]);
    expect(detectRecurring(monthly("NETFLIX", 9.99, 3))).toHaveLength(1);
  });

  it("tells weekly, quarterly and yearly apart", () => {
    expect(
      detectRecurring([charge("WINDOW CLEANER", -15, "2026-01-01"), charge("WINDOW CLEANER", -15, "2026-01-08"), charge("WINDOW CLEANER", -15, "2026-01-15")])[0]
        .cadence
    ).toBe("weekly");

    expect(
      detectRecurring([charge("WATER", -90, "2026-01-01"), charge("WATER", -90, "2026-04-02"), charge("WATER", -90, "2026-07-01")])[0].cadence
    ).toBe("quarterly");

    expect(
      detectRecurring([charge("INSURANCE", -400, "2024-06-01"), charge("INSURANCE", -400, "2025-06-02"), charge("INSURANCE", -400, "2026-06-01")])[0]
        .cadence
    ).toBe("yearly");
  });

  it("ignores money coming in", () => {
    // A salary is the most regular payment there is and belongs nowhere near
    // a list of outgoings.
    const salary = Array.from({ length: 6 }, (_, i) => charge("SALARY", 3000, `2026-0${i + 1}-25`));
    expect(detectRecurring(salary)).toEqual([]);
  });

  it("ignores charges with no rhythm at all", () => {
    expect(
      detectRecurring([charge("AMAZON", -20, "2026-01-03"), charge("AMAZON", -20, "2026-01-09"), charge("AMAZON", -20, "2026-03-27")])
    ).toEqual([]);
  });

  it("puts the most expensive commitment first", () => {
    const found = detectRecurring([...monthly("NETFLIX", 9.99, 4), ...monthly("RENT", 950, 4)]);
    expect(found[0].label).toContain("RENT");
  });

  it("survives same-day duplicates rather than dividing by a zero gap", () => {
    const found = detectRecurring([
      charge("GYM", -30, "2026-01-05"),
      charge("GYM", -30, "2026-01-05"),
      charge("GYM", -30, "2026-02-05"),
      charge("GYM", -30, "2026-03-05"),
    ]);
    expect(found).toHaveLength(1);
  });
});
