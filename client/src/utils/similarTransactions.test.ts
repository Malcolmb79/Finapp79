import { describe, expect, it } from "vitest";
import type { Transaction } from "../api/client.js";
import { matchKey, merchantLabel, similarTransactions } from "./similarTransactions.js";

/**
 * These decide how many rows a single click rewrites, so the failure that
 * matters is matching too much. A bulk change that catches the wrong rows is
 * worse than no bulk change at all: it is quiet, it is plural, and the owner
 * has no record of what the rows used to say.
 */

let n = 0;
const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: `t${++n}`,
    account_id: "a1",
    booking_date: "2026-03-01",
    amount: -10,
    currency: "EUR",
    description: "EXAMPLE SHOP 1234",
    counterparty: null,
    category_id: null,
    source: "csv",
    ...over,
  }) as Transaction;

describe("matchKey", () => {
  // The till reference differs between two visits to one shop. Treating it as
  // part of the name hides every pattern behind it.
  it("treats one merchant with different references as one merchant", () => {
    expect(matchKey(tx({ description: "EXAMPLE SHOP 1234" }))).toBe(matchKey(tx({ description: "EXAMPLE SHOP 9876" })));
  });

  it("keeps different merchants apart", () => {
    expect(matchKey(tx({ description: "EXAMPLE SHOP" }))).not.toBe(matchKey(tx({ description: "SAMPLE CAFE" })));
  });

  it("falls back to the counterparty when there is no description", () => {
    expect(matchKey({ description: null, counterparty: "Gym" })).toBe("gym");
  });
});

describe("similarTransactions", () => {
  const subject = tx({ id: "subject", description: "EXAMPLE SHOP 1111", category_id: 7 });
  const key = matchKey(subject);

  it("finds the merchant's other transactions", () => {
    const all = [subject, tx({ description: "EXAMPLE SHOP 2222" }), tx({ description: "EXAMPLE SHOP 3333" }), tx({ description: "SAMPLE CAFE" })];
    expect(similarTransactions(all, subject, key, { categoryId: 7 })).toHaveLength(2);
  });

  it("never includes the transaction being edited", () => {
    const found = similarTransactions([subject], subject, key, { categoryId: 7 });
    expect(found).toEqual([]);
  });

  /**
   * The count on screen has to be the number of rows that will really change.
   * Offering "apply to 40" and then changing three is the kind of small
   * dishonesty that teaches people to distrust a number.
   */
  it("leaves out rows that already hold the new value", () => {
    const all = [subject, tx({ description: "EXAMPLE SHOP 2222", category_id: 7 }), tx({ description: "EXAMPLE SHOP 3333", category_id: 2 })];
    expect(similarTransactions(all, subject, key, { categoryId: 7 })).toHaveLength(1);
  });

  it("counts a rename only where the name would actually change", () => {
    const all = [subject, tx({ description: "Example Shop" }), tx({ description: "EXAMPLE SHOP 2222" })];
    const found = similarTransactions(all, subject, key, { description: "Example Shop" });
    expect(found.map((t) => t.description)).toEqual(["EXAMPLE SHOP 2222"]);
  });

  /**
   * The one case where a bulk change could do real damage: an empty key would
   * otherwise match every other nameless transaction and rewrite them all.
   */
  it("matches nothing when the merchant has no readable name", () => {
    const nameless = tx({ id: "nameless", description: null, counterparty: null });
    const all = [nameless, tx({ description: null, counterparty: null }), tx({ description: "   " })];
    expect(similarTransactions(all, nameless, matchKey(nameless), { categoryId: 3 })).toEqual([]);
  });

  // A rename and a recategorisation are separate offers; asking about one
  // must not sweep up rows that differ only in the other.
  it("judges a category change on the category alone", () => {
    const all = [subject, tx({ description: "EXAMPLE SHOP 2222", category_id: 7 })];
    expect(similarTransactions(all, subject, key, { categoryId: 7 })).toEqual([]);
  });

  // Clearing a category back to uncategorised is a real change, and null has
  // to be distinguishable from "field not mentioned".
  it("handles clearing a category", () => {
    const all = [subject, tx({ description: "EXAMPLE SHOP 2222", category_id: 7 })];
    expect(similarTransactions(all, subject, key, { categoryId: null })).toHaveLength(1);
  });
});

describe("merchantLabel", () => {
  it("names the merchant for the offer", () => {
    // The cleaned name, matching the row the person just clicked.
    expect(merchantLabel({ description: "VDP-EXAMPLE SHOP Purchase", counterparty: null })).toBe("Example Shop");
    expect(merchantLabel({ description: null, counterparty: "Gym" })).toBe("Gym");
  });

  it("says something rather than nothing when it has no name", () => {
    expect(merchantLabel({ description: null, counterparty: null })).toBe("this merchant");
  });
});
