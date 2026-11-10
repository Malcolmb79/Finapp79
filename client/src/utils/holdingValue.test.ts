import { describe, expect, it } from "vitest";
import type { Holding } from "../api/client.js";
import { holdingContributionsAt, holdingGain, holdingValue, priceAsAt } from "./holdingValue.js";

const holding = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h1",
    name: "World ETF",
    ticker: "VWRL",
    kind: "fund",
    quantity: 10,
    unit_cost: 90,
    currency: "EUR",
    created_at: "2026-01-01",
    prices: [
      { priced_at: "2026-09-01", unit_price: 100 },
      { priced_at: "2026-11-01", unit_price: 110 },
    ],
    ...over,
  }) as Holding;

describe("priceAsAt", () => {
  it("takes the latest price on or before the date", () => {
    expect(priceAsAt(holding(), "2026-10-15")).toBe(100);
    expect(priceAsAt(holding(), "2026-11-01")).toBe(110);
    expect(priceAsAt(holding(), "2026-12-31")).toBe(110);
  });

  // The whole reason prices are kept rather than overwritten: before the
  // first one the app knew nothing, and saying 110 would invent the past.
  it("knows nothing before the first price", () => {
    expect(priceAsAt(holding(), "2026-08-31")).toBeNull();
  });
});

describe("holdingValue", () => {
  it("is quantity times the latest price", () => {
    expect(holdingValue(holding())).toBeCloseTo(1100);
  });

  // Null, not zero, and the difference is the whole point: a holding nobody
  // has priced is unknown, and zero is a claim that it is worthless.
  it("is unknown when never priced", () => {
    expect(holdingValue(holding({ prices: [] }))).toBeNull();
  });
});

describe("holdingGain", () => {
  it("compares value against what it cost", () => {
    expect(holdingGain(holding())).toEqual({ absolute: 200, fraction: 200 / 900 });
  });

  it("says nothing without a cost basis", () => {
    expect(holdingGain(holding({ unit_cost: null }))).toBeNull();
  });

  it("avoids dividing by a zero cost", () => {
    expect(holdingGain(holding({ unit_cost: 0 }))?.fraction).toBeNull();
  });
});

describe("holdingContributionsAt", () => {
  it("values a holding at the price in effect then", () => {
    expect(holdingContributionsAt([holding()], "2026-10-01")).toEqual([{ amount: 1000, currency: "EUR" }]);
  });

  // Absent rather than zero, so a net worth trend shows a holding appearing
  // when it was first priced instead of dragging the line down before it.
  it("leaves a holding out before its first price", () => {
    expect(holdingContributionsAt([holding()], "2026-08-01")).toEqual([]);
  });
});
