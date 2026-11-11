import { describe, expect, it } from "vitest";
import type { Transaction } from "../api/client.js";
import { duplicateCount, findDuplicates } from "./findDuplicates.js";

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
