import { describe, expect, it } from "vitest";
import { merchantSearchQuery, merchantSearchUrl } from "./merchantSearch.js";

/**
 * This text leaves the app, so the failure that matters is not a bad search —
 * it is handing an account identifier to a third party to find out the name of
 * a shop. Every case below is a descriptor shape that carries one.
 *
 * The descriptors here are invented in the formats real banks use.
 */

describe("merchantSearchQuery", () => {
  it("asks about the merchant", () => {
    expect(merchantSearchQuery("VDP-EXAMPLE SHOP Purchase")).toBe("Example Shop");
    expect(merchantSearchQuery("VDC-TST-Sample Diner Purchase")).toBe("Sample Diner");
  });

  // The one that matters most: a direct debit descriptor carries an IBAN.
  it("never sends an account number", () => {
    const query = merchantSearchQuery("D/D SAMPLE OPTICIANS IE00000000000000 1111111-2222-333333 Direct debit");
    expect(query).toBe("Sample Opticians");
    expect(query).not.toMatch(/\d{5,}/);
  });

  it("never sends a card tail", () => {
    const query = merchantSearchQuery("VDP-Examplebank**0000* Purchase");
    expect(query).not.toMatch(/0000/);
  });

  it("drops a long reference that survived cleaning", () => {
    const query = merchantSearchQuery("ACS*41382644 Example Telecom");
    expect(query).not.toMatch(/41382644/);
    expect(query).toContain("Example");
  });

  // A short number can be part of a name — "Shop 24" — and is no identifier.
  it("keeps a short number that is part of the name", () => {
    expect(merchantSearchQuery("VDP-EXAMPLE 24 SHOP Purchase")).toBe("Example 24 Shop");
  });

  /**
   * Nothing recognisable left once the identifiers are gone. Searching the
   * remainder would be pointless; searching the original would be the exact
   * thing this exists to prevent.
   */
  it("refuses rather than searching a bare reference", () => {
    expect(merchantSearchQuery("IE00000000000000 Direct debit")).toBeNull();
    expect(merchantSearchQuery("000000000000000000")).toBeNull();
    expect(merchantSearchQuery(null)).toBeNull();
    expect(merchantSearchQuery("")).toBeNull();
  });

  it("falls back to the counterparty when there is no description", () => {
    expect(merchantSearchQuery(null, "Example Gym")).toBe("Example Gym");
  });
});

describe("merchantSearchUrl", () => {
  it("encodes the query", () => {
    expect(merchantSearchUrl("Sample Diner")).toBe("https://duckduckgo.com/?q=Sample%20Diner%20bank%20transaction");
  });

  // Not Google: this query says where somebody shops, and answering "who is
  // this merchant" should not also file that against an advertising profile.
  it("does not go to an advertising search engine", () => {
    expect(merchantSearchUrl("Example")).toContain("duckduckgo.com");
    expect(merchantSearchUrl("Example")).not.toContain("google");
  });
});
