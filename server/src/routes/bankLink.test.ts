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
    const balances = [balance("ITAV", "999.00"), balance("CLBD", "500.00")];
    expect(pickBalance(balances, BOOKED_BALANCE_TYPES)).toBe(500);
  });

  // The exact payload AIB returns. It sends no booked balance at all, and the
  // figure its own app displays as the account balance arrives as ITAV --
  // so the balance has to be willing to fall back to it.
  describe("a bank that reports no booked balance", () => {
    const aib = [
      balance("XPCD", "8255.35"), // "composed of booked entries and pending items"
      balance("ITAV", "3099.26"), // what AIB's app calls the balance
      balance("OPAV", "-2862.61"),
    ];

    it("falls back to the interim available figure as the balance", () => {
      expect(pickBalance(aib, BOOKED_BALANCE_TYPES)).toBe(3099.26);
    });

    // Taking XPCD as booked overstated this account by 5,156.09 -- silently,
    // and in the direction that flatters. Never pick it.
    it("never treats the pending-items forecast as a balance", () => {
      expect(pickBalance(aib, BOOKED_BALANCE_TYPES)).not.toBe(8255.35);
      expect(pickBalance(aib, AVAILABLE_BALANCE_TYPES)).not.toBe(8255.35);
      expect(pickBalance([balance("XPCD", "8255.35")], BOOKED_BALANCE_TYPES)).toBeNull();
    });

    // An opening balance is where the day started, not where it stands.
    it("never treats the opening balance as available", () => {
      expect(pickBalance(aib, AVAILABLE_BALANCE_TYPES)).not.toBe(-2862.61);
    });
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
