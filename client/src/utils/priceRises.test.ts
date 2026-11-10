import { describe, expect, it } from "vitest";
import { detectPriceRises } from "./priceRises.js";

const charge = (date: string, amount: number, description = "STREAMFLIX") => ({
  amount: -amount,
  booking_date: date,
  description,
  counterparty: null,
});

/**
 * The point of this is a phone call, so a false positive wastes someone's
 * afternoon. Most of these guard against flagging something that never had a
 * price in the first place.
 */
describe("detectPriceRises", () => {
  it("spots a settled price going up", () => {
    const rises = detectPriceRises([
      charge("2026-08-15", 9.99),
      charge("2026-09-15", 9.99),
      charge("2026-10-15", 9.99),
      charge("2026-11-15", 12.99),
    ]);
    expect(rises).toHaveLength(1);
    expect(rises[0].was).toBeCloseTo(9.99);
    expect(rises[0].now).toBeCloseTo(12.99);
    expect(rises[0].since).toBe("2026-11-15");
    // The figure that makes it worth acting on: £3 a month is £36 a year.
    expect(rises[0].annualIncrease).toBeCloseTo(36, 0);
  });

  // A supermarket is not a subscription. Without this the list fills with
  // every merchant whose last shop happened to be dearer.
  it("ignores a merchant whose charges never agreed", () => {
    const rises = detectPriceRises([
      charge("2026-08-02", 41.2, "TESCO"),
      charge("2026-09-02", 88.4, "TESCO"),
      charge("2026-10-02", 23.75, "TESCO"),
      charge("2026-11-02", 95.1, "TESCO"),
    ]);
    expect(rises).toEqual([]);
  });

  it("ignores a change too small to be a price rise", () => {
    const rises = detectPriceRises([
      charge("2026-08-15", 10.0),
      charge("2026-09-15", 10.0),
      charge("2026-10-15", 10.0),
      charge("2026-11-15", 10.1),
    ]);
    expect(rises).toEqual([]);
  });

  it("ignores a price that fell", () => {
    const rises = detectPriceRises([
      charge("2026-08-15", 12.99),
      charge("2026-09-15", 12.99),
      charge("2026-10-15", 12.99),
      charge("2026-11-15", 9.99),
    ]);
    expect(rises).toEqual([]);
  });

  it("needs enough history to know what the old price was", () => {
    const rises = detectPriceRises([charge("2026-10-15", 9.99), charge("2026-11-15", 12.99)]);
    expect(rises).toEqual([]);
  });

  it("ignores money coming in", () => {
    const rises = detectPriceRises([
      { amount: 100, booking_date: "2026-08-01", description: "REFUND", counterparty: null },
      { amount: 100, booking_date: "2026-09-01", description: "REFUND", counterparty: null },
      { amount: 100, booking_date: "2026-10-01", description: "REFUND", counterparty: null },
      { amount: 180, booking_date: "2026-11-01", description: "REFUND", counterparty: null },
    ]);
    expect(rises).toEqual([]);
  });

  it("puts the most expensive rise first", () => {
    const rises = detectPriceRises([
      ...["2026-08-15", "2026-09-15", "2026-10-15"].map((d) => charge(d, 9.99, "SMALL CO")),
      charge("2026-11-15", 11.99, "SMALL CO"),
      ...["2026-08-03", "2026-09-03", "2026-10-03"].map((d) => charge(d, 60, "BIG CO")),
      charge("2026-11-03", 80, "BIG CO"),
    ]);
    expect(rises.map((r) => r.label)).toEqual(["BIG CO", "SMALL CO"]);
  });
});
