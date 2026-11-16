import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "../api/client.js";
import {
  excludeTransfers,
  findTransferPairs,
  isTransfer,
  pairNote,
  PAIR_TOLERANCE,
  PAIR_WINDOW_DAYS,
  transferCategoryIds,
} from "./transfers.js";

const money = (value: number) => `€${value.toFixed(2)}`;

const category = (id: number, name: string, is_transfer = false): Category =>
  ({ id, name, parent_id: null, is_transfer }) as Category;

let counter = 0;
const tx = (over: Partial<Transaction>): Transaction =>
  ({
    id: `t${++counter}`,
    account_id: "current",
    category_id: null,
    booking_date: "2026-11-10",
    amount: -100,
    currency: "EUR",
    description: null,
    counterparty: null,
    source: "manual",
    reviewed_at: "2026-11-10",
    ...over,
  }) as Transaction;

const TRANSFERS = 7;
const categories = [category(1, "Groceries"), category(TRANSFERS, "Transfers", true)];

describe("transferCategoryIds", () => {
  it("picks out the categories declared as transfers", () => {
    expect(transferCategoryIds(categories)).toEqual(new Set([TRANSFERS]));
  });

  it("is empty when nothing has been declared", () => {
    expect(transferCategoryIds([category(1, "Groceries")]).size).toBe(0);
  });
});

describe("excludeTransfers", () => {
  const ids = transferCategoryIds(categories);

  /**
   * The fault this exists for. One €2,000 move to savings is two real rows;
   * counted as income and spending it reports €2,000 more earned and €2,000
   * more spent than happened, and a savings rate built on those two figures
   * is wrong top and bottom.
   */
  it("drops both halves of a transfer from the totals", () => {
    const rows = [
      tx({ amount: -2000, category_id: TRANSFERS, account_id: "current" }),
      tx({ amount: 2000, category_id: TRANSFERS, account_id: "savings" }),
      tx({ amount: 4200, category_id: null, account_id: "current" }),
      tx({ amount: -85, category_id: 1, account_id: "current" }),
    ];
    const kept = excludeTransfers(rows, ids);
    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r.amount)).toEqual([4200, -85]);
  });

  it("leaves everything alone when nothing is declared a transfer", () => {
    const rows = [tx({ amount: -2000, category_id: TRANSFERS })];
    expect(excludeTransfers(rows, new Set())).toHaveLength(1);
  });

  it("keeps an uncategorised row, because nobody has said what it is", () => {
    expect(excludeTransfers([tx({ amount: 2000, category_id: null })], ids)).toHaveLength(1);
  });

  it("reads one transaction the same way", () => {
    expect(isTransfer(tx({ category_id: TRANSFERS }), ids)).toBe(true);
    expect(isTransfer(tx({ category_id: 1 }), ids)).toBe(false);
    expect(isTransfer(tx({ category_id: null }), ids)).toBe(false);
  });
});

describe("findTransferPairs", () => {
  it("matches a payment out to the payment in that followed it", () => {
    const out = tx({ amount: -2000, account_id: "current", booking_date: "2026-11-10" });
    const into = tx({ amount: 2000, account_id: "savings", booking_date: "2026-11-11" });
    const [pair] = findTransferPairs([out, into]);
    expect(pair.out.id).toBe(out.id);
    expect(pair.in.id).toBe(into.id);
    expect(pair.daysApart).toBe(1);
    expect(pair.gap).toBe(0);
  });

  /**
   * A payment and a refund on one card is not a transfer. Nor is a reversal,
   * nor a correction — all three look identical to this otherwise.
   */
  it("refuses a match on the same account", () => {
    const rows = [
      tx({ amount: -2000, account_id: "current", booking_date: "2026-11-10" }),
      tx({ amount: 2000, account_id: "current", booking_date: "2026-11-11" }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("will not reach past the window", () => {
    const rows = [
      tx({ amount: -500, account_id: "a", booking_date: "2026-11-01" }),
      tx({ amount: 500, account_id: "b", booking_date: `2026-11-${String(1 + PAIR_WINDOW_DAYS + 1).padStart(2, "0")}` }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  /**
   * Not an exact match: a transfer between currencies, or one that attracts a
   * fee, arrives slightly smaller than it left.
   */
  it("allows a fee-sized difference and names it", () => {
    const rows = [
      tx({ amount: -1000, account_id: "a", booking_date: "2026-11-10" }),
      tx({ amount: 990, account_id: "b", booking_date: "2026-11-11" }),
    ];
    const [pair] = findTransferPairs(rows);
    expect(pair.gap).toBe(10);
    expect(pairNote(pair, money)).toContain("fee or an exchange rate");
  });

  it("refuses a difference too big to be a fee", () => {
    const rows = [
      tx({ amount: -1000, account_id: "a", booking_date: "2026-11-10" }),
      tx({ amount: 1000 * (1 - PAIR_TOLERANCE * 2), account_id: "b", booking_date: "2026-11-11" }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  /**
   * One payment out cannot be the partner of three different payments in.
   * Each row is used at most once, best match first.
   */
  it("uses each row once, taking the closest match", () => {
    const out = tx({ amount: -500, account_id: "a", booking_date: "2026-11-10" });
    const exact = tx({ amount: 500, account_id: "b", booking_date: "2026-11-12" });
    const near = tx({ amount: 495, account_id: "b", booking_date: "2026-11-10" });
    const pairs = findTransferPairs([out, near, exact]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].in.id).toBe(exact.id);
  });

  it("pairs several transfers without crossing them over", () => {
    const rows = [
      tx({ amount: -100, account_id: "a", booking_date: "2026-11-01" }),
      tx({ amount: 100, account_id: "b", booking_date: "2026-11-01" }),
      tx({ amount: -100, account_id: "a", booking_date: "2026-11-20" }),
      tx({ amount: 100, account_id: "b", booking_date: "2026-11-20" }),
    ];
    const pairs = findTransferPairs(rows);
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map((p) => p.in.id)).size).toBe(2);
  });

  // So the screen can tell a confirmation apart from a suggestion.
  it("says when both halves are already filed as transfers", () => {
    const ids = transferCategoryIds(categories);
    const rows = [
      tx({ amount: -300, account_id: "a", category_id: TRANSFERS, booking_date: "2026-11-10" }),
      tx({ amount: 300, account_id: "b", category_id: TRANSFERS, booking_date: "2026-11-10" }),
    ];
    expect(findTransferPairs(rows, ids)[0].alreadyMarked).toBe(true);
    expect(findTransferPairs(rows)[0].alreadyMarked).toBe(false);
  });

  it("gives a stable key whichever way round the rows arrive", () => {
    const out = tx({ id: "out1", amount: -50, account_id: "a", booking_date: "2026-11-10" });
    const into = tx({ id: "in1", amount: 50, account_id: "b", booking_date: "2026-11-10" });
    expect(findTransferPairs([out, into])[0].key).toBe(findTransferPairs([into, out])[0].key);
  });

  it("finds nothing in a list with nothing to find", () => {
    expect(findTransferPairs([tx({ amount: -40 }), tx({ amount: -90 })])).toEqual([]);
    expect(findTransferPairs([])).toEqual([]);
  });

  it("ignores a zero", () => {
    expect(findTransferPairs([tx({ amount: -0, account_id: "a" }), tx({ amount: 0, account_id: "b" })])).toEqual([]);
  });
});

describe("pairNote", () => {
  it("says the same day when it was the same day", () => {
    const rows = [
      tx({ amount: -2000, account_id: "a", booking_date: "2026-11-10" }),
      tx({ amount: 2000, account_id: "b", booking_date: "2026-11-10" }),
    ];
    expect(pairNote(findTransferPairs(rows)[0], money)).toContain("the same day");
  });
});
