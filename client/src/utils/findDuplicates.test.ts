import { describe, expect, it } from "vitest";
import type { Transaction } from "../api/client.js";
import { duplicateCount, findDuplicates, isTruncationOf } from "./findDuplicates.js";

/**
 * This offers to delete somebody's transactions, so the failure that matters
 * is a false positive. Two coffees of the same price on one day is an
 * ordinary Tuesday, and an app that quietly removed one would be losing a
 * payment that happened — which is why what follows is only ever an offer,
 * and why "different account" and "different amount" are tested as hard
 * boundaries rather than heuristics.
 */

let n = 0;
const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: `t${++n}`,
    account_id: "a1",
    booking_date: "2026-11-10",
    amount: -3.35,
    currency: "EUR",
    description: "Example Cafe",
    counterparty: null,
    category_id: null,
    source: "enablebanking",
    created_at: "2026-11-10T09:00:00Z",
    reviewed_at: "2026-11-10T09:00:00Z",
    ...over,
  }) as Transaction;

describe("findDuplicates", () => {
  it("spots the same payment stored twice", () => {
    const groups = findDuplicates([
      tx({ id: "first", created_at: "2026-11-10T09:00:00Z" }),
      tx({ id: "second", created_at: "2026-11-11T09:00:00Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].original.id).toBe("first");
    expect(groups[0].copies.map((c) => c.id)).toEqual(["second"]);
  });

  // The one that arrived first is the one other things may already reference.
  it("keeps the earliest as the original", () => {
    const groups = findDuplicates([
      tx({ id: "later", created_at: "2026-12-01T00:00:00Z" }),
      tx({ id: "earlier", created_at: "2026-11-10T00:00:00Z" }),
    ]);
    expect(groups[0].original.id).toBe("earlier");
  });

  // The case the id schemes cannot catch: one from the sync, one from an
  // import, neither dedupe seeing the other.
  it("finds a pair that arrived by different routes", () => {
    const groups = findDuplicates([tx({ id: "synced", source: "enablebanking" }), tx({ id: "imported", source: "csv" })]);
    expect(groups).toHaveLength(1);
  });

  it("leaves a single transaction alone", () => {
    expect(findDuplicates([tx()])).toEqual([]);
  });

  it("does not pair across accounts", () => {
    expect(findDuplicates([tx({ account_id: "a1" }), tx({ account_id: "a2" })])).toEqual([]);
  });

  it("does not pair different amounts or different days", () => {
    expect(findDuplicates([tx({ amount: -3.35 }), tx({ amount: -3.36 })])).toEqual([]);
    expect(findDuplicates([tx({ booking_date: "2026-11-10" }), tx({ booking_date: "2026-11-11" })])).toEqual([]);
  });

  // Every zero-amount row matches every other on the same day, which is
  // evidence of nothing.
  it("ignores zero-amount rows", () => {
    expect(findDuplicates([tx({ amount: 0 }), tx({ amount: 0 })])).toEqual([]);
  });

  it("handles three copies of one payment", () => {
    const groups = findDuplicates([
      tx({ id: "a", created_at: "2026-11-10T01:00:00Z" }),
      tx({ id: "b", created_at: "2026-11-10T02:00:00Z" }),
      tx({ id: "c", created_at: "2026-11-10T03:00:00Z" }),
    ]);
    expect(groups[0].original.id).toBe("a");
    expect(duplicateCount(groups)).toBe(2);
  });

  // A duplicated salary matters more than a duplicated coffee.
  it("puts the largest first", () => {
    const groups = findDuplicates([
      tx({ amount: -3.35 }),
      tx({ amount: -3.35 }),
      tx({ amount: 1250, booking_date: "2026-11-09" }),
      tx({ amount: 1250, booking_date: "2026-11-09" }),
    ]);
    expect(Math.abs(groups[0].original.amount)).toBe(1250);
  });

  it("is stable when nothing records when a row arrived", () => {
    const groups = findDuplicates([tx({ id: "bbb", created_at: undefined }), tx({ id: "aaa", created_at: undefined })]);
    expect(groups[0].original.id).toBe("aaa");
  });
});

/**
 * The pending copy and the booked copy of one payment. The bank announces it,
 * then records it: a day apart, and described by two pipelines that cut the
 * string at different lengths. Every one of these slipped through while the
 * rule asked for the same calendar day.
 */
describe("a payment booked twice, days apart", () => {
  const pending = tx({ booking_date: "2026-11-11", description: "help.hbomax.com", amount: -15.99, created_at: "2026-11-11T02:00:00Z" });
  const booked = tx({ booking_date: "2026-11-12", description: "help.hbomax.co", amount: -15.99, created_at: "2026-11-12T02:00:00Z" });

  it("pairs them, and keeps the one that arrived first", () => {
    const groups = findDuplicates([pending, booked]);
    expect(groups).toHaveLength(1);
    expect(groups[0].original.id).toBe(pending.id);
    expect(groups[0].copies).toHaveLength(1);
    expect(groups[0].kind).toBe("days-apart");
  });

  // The whole reason the rule can afford to look across days. Two identical
  // descriptions are two purchases; a string cut at two lengths is one.
  it("leaves two identical descriptions days apart alone", () => {
    const groups = findDuplicates([
      tx({ booking_date: "2026-11-11", description: "Example Cafe" }),
      tx({ booking_date: "2026-11-12", description: "Example Cafe" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("will not reach across a long gap", () => {
    const groups = findDuplicates([
      tx({ booking_date: "2026-11-01", description: "help.hbomax.com", amount: -15.99 }),
      tx({ booking_date: "2026-11-20", description: "help.hbomax.co", amount: -15.99 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("still separates different accounts and different amounts", () => {
    expect(
      findDuplicates([
        tx({ booking_date: "2026-11-11", description: "help.hbomax.com", amount: -15.99 }),
        tx({ booking_date: "2026-11-12", description: "help.hbomax.co", amount: -15.99, account_id: "a2" }),
      ])
    ).toHaveLength(0);
    expect(
      findDuplicates([
        tx({ booking_date: "2026-11-11", description: "help.hbomax.com", amount: -15.99 }),
        tx({ booking_date: "2026-11-12", description: "help.hbomax.co", amount: -16.99 }),
      ])
    ).toHaveLength(0);
  });

  it("counts the copies it would remove", () => {
    expect(duplicateCount(findDuplicates([pending, booked]))).toBe(1);
  });
});

describe("isTruncationOf", () => {
  it("sees a string cut short", () => {
    expect(isTruncationOf("help.hbomax.com", "help.hbomax.co")).toBe(true);
    expect(isTruncationOf("help.hbomax.co", "help.hbomax.com")).toBe(true);
  });

  // Identical is two purchases, not one payment described twice.
  it("is false for identical strings", () => {
    expect(isTruncationOf("Example Cafe", "Example Cafe")).toBe(false);
    expect(isTruncationOf("EXAMPLE CAFE", "example cafe")).toBe(false);
  });

  // A short prefix matches half the ledger.
  it("refuses a prefix too short to identify anything", () => {
    expect(isTruncationOf("Tes", "Tesco Stores Dublin")).toBe(false);
    expect(isTruncationOf("", "anything")).toBe(false);
    expect(isTruncationOf(null, "anything")).toBe(false);
  });

  /**
   * The shape the bank actually produces, which whole-string matching misses.
   * One copy carries the scheme prefix and the other does not, and the cut is
   * inside the string rather than at the end, so neither is a prefix of the
   * other however they are lined up.
   */
  it("sees a merchant cut short inside differently wrapped descriptions", () => {
    expect(isTruncationOf("VDP-shop.example.co Purchase", "shop.example.com Purchase")).toBe(true);
    expect(isTruncationOf("shop.example.com Purchase", "VDP-shop.example.co Purchase")).toBe(true);
  });

  // Same merchant, different wrapping, is two visits rather than one payment.
  it("is false when the merchant matches exactly and only the wrapping differs", () => {
    expect(isTruncationOf("VDP-shop.example.com Purchase", "shop.example.com Purchase")).toBe(false);
  });

  // The pair that would cost a real payment: same day, same amount, two
  // different shops.
  it("is false for two different merchants", () => {
    expect(isTruncationOf("VDP-Examplebank**1234* Purchase", "VDP-Othershop Purchase")).toBe(false);
  });

  it("is false when neither is a prefix of the other", () => {
    expect(isTruncationOf("Example Cafe", "Example Bakery")).toBe(false);
  });
});
