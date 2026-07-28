import { describe, expect, it, vi, afterEach } from "vitest";
import { analyseSpending, baselineLimit, median, slopePerMonth } from "./budgetPlanner.js";

const spend = (category: string, amount: number, booking_date: string) => ({
  amount: -amount,
  booking_date,
  category,
});

// The window excludes the current month, so tests need a fixed "now" to have
// a stable idea of which months are complete.
function withToday(iso: string, run: () => void) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
  try {
    run();
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => vi.useRealTimers());

describe("median", () => {
  it("takes the middle of an odd count and the midpoint of an even one", () => {
    expect(median([10, 30, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("is zero for nothing", () => {
    expect(median([])).toBe(0);
  });
});

describe("slopePerMonth", () => {
  it("reads a steady climb", () => {
    expect(slopePerMonth([100, 110, 120, 130])).toBeCloseTo(10, 5);
  });

  it("reads a steady fall", () => {
    expect(slopePerMonth([130, 120, 110, 100])).toBeCloseTo(-10, 5);
  });

  // Fitted across every point, so one odd month doesn't set the direction —
  // reading a trend off the endpoints would call this one flat.
  it("is not decided by the first and last months alone", () => {
    expect(slopePerMonth([100, 130, 160, 100])).toBeLessThan(10);
    expect(slopePerMonth([100, 130, 160, 100])).toBeGreaterThan(-10);
  });
});

describe("analyseSpending", () => {
  it("leaves the current month out of the figures", () => {
    withToday("2026-07-10", () => {
      const analysis = analyseSpending(
        [spend("Groceries", 400, "2026-05-04"), spend("Groceries", 400, "2026-06-04"), spend("Groceries", 30, "2026-07-02")],
        "EUR"
      );
      // A part-month counted whole drags every average down and makes every
      // category look like it is falling.
      expect(analysis.monthsCovered).toEqual(["2026-05", "2026-06"]);
      expect(analysis.categories[0].typical).toBe(400);
    });
  });

  it("counts months with nothing spent", () => {
    withToday("2026-07-10", () => {
      const analysis = analyseSpending(
        [
          spend("Car", 600, "2026-02-10"),
          spend("Car", 600, "2026-05-10"),
          // Two other months of activity so the window is six months wide.
          spend("Food", 10, "2026-01-05"),
          spend("Food", 10, "2026-03-05"),
          spend("Food", 10, "2026-04-05"),
          spend("Food", 10, "2026-06-05"),
        ],
        "EUR"
      );
      const car = analysis.categories.find((c) => c.category === "Car")!;
      // Two months of six at 600 is 200 a month, not 600 — budgeting it at
      // the months it happened to fall in sets it three times too high.
      expect(car.months).toHaveLength(6);
      expect(car.mean).toBe(200);
      expect(car.typical).toBe(0);
    });
  });

  it("separates a steady category from an erratic one", () => {
    withToday("2026-07-10", () => {
      const entries = [
        ...["01", "02", "03", "04", "05", "06"].map((m) => spend("Rent", 900, `2026-${m}-01`)),
        spend("Holidays", 1800, "2026-03-01"),
        spend("Holidays", 60, "2026-05-01"),
      ];
      const analysis = analyseSpending(entries, "EUR");
      const rent = analysis.categories.find((c) => c.category === "Rent")!;
      const holidays = analysis.categories.find((c) => c.category === "Holidays")!;

      expect(rent.volatility).toBeLessThan(0.05);
      expect(holidays.volatility).toBeGreaterThan(1);
    });
  });

  it("reports income and spend for a typical month", () => {
    withToday("2026-07-10", () => {
      const analysis = analyseSpending(
        [
          { amount: 3000, booking_date: "2026-05-25", category: null },
          { amount: 3000, booking_date: "2026-06-25", category: null },
          spend("Groceries", 500, "2026-05-04"),
          spend("Groceries", 700, "2026-06-04"),
        ],
        "EUR"
      );
      expect(analysis.typicalIncome).toBe(3000);
      expect(analysis.typicalSpend).toBe(600);
    });
  });

  it("files spending with no category rather than dropping it", () => {
    withToday("2026-07-10", () => {
      const analysis = analyseSpending([{ amount: -80, booking_date: "2026-06-04", category: null }], "EUR");
      expect(analysis.categories[0].category).toBe("Uncategorised");
    });
  });
});

describe("baselineLimit", () => {
  const base = {
    category: "X",
    months: [],
    mean: 0,
    highest: 0,
    lowest: 0,
    latest: 0,
    trend: 0,
    transactions: 0,
  };

  it("adds barely anything to a standing charge", () => {
    // Rent doesn't need headroom, and giving it any invites the money to be
    // spent elsewhere.
    expect(baselineLimit({ ...base, typical: 900, volatility: 0.01 })).toBe(945);
  });

  it("gives an erratic category real headroom", () => {
    // A budget breached in the first week stops being used at all.
    expect(baselineLimit({ ...base, typical: 200, volatility: 0.9 })).toBe(300);
  });

  it("never lets the margin run away", () => {
    expect(baselineLimit({ ...base, typical: 100, volatility: 12 })).toBe(150);
  });
});
