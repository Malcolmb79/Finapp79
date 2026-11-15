import { describe, expect, it } from "vitest";
import { budgetCurrency } from "./budgets.js";

/**
 * A budget's currency decides which transactions count against it, so getting
 * this wrong is not a validation nicety: a cap filed under a code nothing is
 * denominated in matches no spending and reads as nothing spent.
 */
describe("budgetCurrency", () => {
  it("defaults to euro when nothing is sent", () => {
    expect(budgetCurrency(undefined)).toBe("EUR");
    expect(budgetCurrency(null)).toBe("EUR");
  });

  it("accepts a code in any case, trimmed", () => {
    expect(budgetCurrency("gbp")).toBe("GBP");
    expect(budgetCurrency(" eur ")).toBe("EUR");
  });

  // Refused rather than coerced. A budget under a made-up code counts no
  // spending, and a row reading zero spent looks like an underspend.
  it("refuses anything that is not a three-letter code", () => {
    expect(budgetCurrency("")).toBeNull();
    expect(budgetCurrency("EURO")).toBeNull();
    expect(budgetCurrency("\u20ac")).toBeNull();
    expect(budgetCurrency("GB1")).toBeNull();
    expect(budgetCurrency(826)).toBeNull();
    expect(budgetCurrency({ code: "GBP" })).toBeNull();
  });
});
