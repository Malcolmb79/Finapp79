import { describe, expect, it } from "vitest";
import { AVAILABLE_BALANCE_TYPES, BOOKED_BALANCE_TYPES, pickBalance } from "./bankLink.js";

const balance = (balance_type: string, amount: string) => ({
  balance_type,
  balance_amount: { amount, currency: "EUR" },
});

// These were originally written as Berlin Group camelCase names
// ("closingBooked"), which Enable Banking never sends -- so every lookup
// missed, the update was skipped, and linked accounts silently fell back to
// summing their 90-day transaction window. Nothing failed loudly; the balance
// was just quietly wrong.
describe("pickBalance", () => {
  it("reads the ISO 20022 codes the API actually returns", () => {
    const balances = [balance("CLBD", "1234.56"), balance("ITAV", "1100.00")];
    expect(pickBalance(balances, BOOKED_BALANCE_TYPES)).toBe(1234.56);
    expect(pickBalance(balances, AVAILABLE_BALANCE_TYPES)).toBe(1100);
  });

  it("falls back through the preference order when a bank omits the first choice", () => {
    // No CLBD here -- a bank reporting only an interim booked figure should
    // still produce a balance rather than none at all.
    expect(pickBalance([balance("ITBD", "42.00")], BOOKED_BALANCE_TYPES)).toBe(42);
  });

  it("prefers the most specific type over one later in the order", () => {
    const balances = [balance("XPCD", "999.00"), balance("CLBD", "500.00")];
    expect(pickBalance(balances, BOOKED_BALANCE_TYPES)).toBe(500);
  });

  it("returns null rather than a balance of zero when nothing matches", () => {
    // Number(undefined) is NaN and Number("") is 0 -- either one written to
    // the accounts row would read as a real balance of zero.
    expect(pickBalance([balance("INFO", "0.00")], BOOKED_BALANCE_TYPES)).toBeNull();
    expect(pickBalance([], BOOKED_BALANCE_TYPES)).toBeNull();
    expect(pickBalance([balance("CLBD", "not a number")], BOOKED_BALANCE_TYPES)).toBeNull();
  });

  it("keeps a negative balance negative for an overdrawn account", () => {
    expect(pickBalance([balance("CLBD", "-320.75")], BOOKED_BALANCE_TYPES)).toBe(-320.75);
  });
});
