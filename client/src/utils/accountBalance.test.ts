import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { accountTxSums, repaymentMirrors, spendingTransactions, staleness, visibleAccounts, visibleTransactions } from "./accountBalance.js";

function account(id: string, hidden?: boolean): Account {
  return { id, name: id, currency: "EUR", source: "manual", hidden } as Account;
}

describe("visibleAccounts", () => {
  it("drops hidden accounts and keeps the rest", () => {
    const accounts = [account("a"), account("b", true), account("c", false)];
    expect(visibleAccounts(accounts).map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("treats a missing flag as visible, so existing accounts are unaffected", () => {
    expect(visibleAccounts([account("a")])).toHaveLength(1);
  });
});

describe("visibleTransactions", () => {
  const accounts = [account("a"), account("b", true)];

  it("drops transactions belonging to a hidden account", () => {
    const txs = [
      { account_id: "a", amount: -10 },
      { account_id: "b", amount: -999 },
    ];
    expect(visibleTransactions(txs, accounts)).toEqual([{ account_id: "a", amount: -10 }]);
  });

  // The point of the whole helper: net worth and spending have to agree about
  // which accounts exist, or one view counts an account the other has dropped.
  it("hides an account and its spending together", () => {
    const txs = [{ account_id: "b", amount: -50 }];
    expect(visibleAccounts(accounts)).toHaveLength(1);
    expect(visibleTransactions(txs, accounts)).toHaveLength(0);
  });

  it("returns the same array when nothing is hidden", () => {
    const txs = [{ account_id: "a", amount: -10 }];
    expect(visibleTransactions(txs, [account("a")])).toBe(txs);
  });
});

describe("scoping to one account", () => {
  const accounts = [account("a"), account("b"), account("c", true)];

  it("narrows the accounts to the one chosen", () => {
    expect(visibleAccounts(accounts, "b").map((a) => a.id)).toEqual(["b"]);
  });

  it("narrows the transactions to the same one", () => {
    const txs = [
      { account_id: "a", amount: -10 },
      { account_id: "b", amount: -20 },
    ];
    expect(visibleTransactions(txs, accounts, "b")).toEqual([{ account_id: "b", amount: -20 }]);
  });

  // Asking to look at one account is explicit; a page of zeroes because it is
  // also hidden would be a worse answer than the account's real figures.
  it("lets an explicit choice override the hidden flag, on both sides", () => {
    expect(visibleAccounts(accounts, "c").map((a) => a.id)).toEqual(["c"]);
    expect(visibleTransactions([{ account_id: "c", amount: -5 }], accounts, "c")).toHaveLength(1);
  });

  it("falls back to every visible account when no choice is made", () => {
    expect(visibleAccounts(accounts, null).map((a) => a.id)).toEqual(["a", "b"]);
  });

  // The header loads accounts asynchronously, so a scoped filter has to be
  // right before that list arrives — filtering by id keeps it correct.
  it("scopes correctly while the accounts are still loading", () => {
    const txs = [
      { account_id: "a", amount: -10 },
      { account_id: "b", amount: -20 },
    ];
    expect(visibleTransactions(txs, [], "b")).toHaveLength(1);
  });
});

describe("staleness", () => {
  const NOW = Date.parse("2026-07-31T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const linked = (synced: string | null) =>
    ({ id: "l", name: "Linked", currency: "EUR", source: "enablebanking", balance_synced_at: synced }) as Account;
  const manual = (lastImport: string | null) =>
    ({ id: "m", name: "Manual", currency: "EUR", source: "manual", last_import_at: lastImport }) as Account;

  it("flags a linked account that hasn't synced in 30 days", () => {
    expect(staleness(linked(daysAgo(45)), NOW)).toEqual({ days: 45, kind: "sync" });
  });

  it("says nothing about one that synced recently", () => {
    expect(staleness(linked(daysAgo(3)), NOW)).toBeNull();
  });

  it("flags a linked account that has never synced", () => {
    expect(staleness(linked(null), NOW)).toEqual({ days: null, kind: "sync" });
  });

  it("flags a manual account whose imports have stopped", () => {
    expect(staleness(manual(daysAgo(60)), NOW)).toEqual({ days: 60, kind: "import" });
  });

  // The rule that keeps the flag worth having: an account kept by hand isn't
  // stale for going a month without an entry. Flag those and the flag is on
  // half the list, which is the same as it not being there.
  it("says nothing about a hand-kept account that has never been imported to", () => {
    expect(staleness(manual(null), NOW)).toBeNull();
  });

  it("does not flag on the boundary day, only once past it", () => {
    expect(staleness(linked(daysAgo(29)), NOW)).toBeNull();
    expect(staleness(linked(daysAgo(30)), NOW)).toEqual({ days: 30, kind: "sync" });
  });

  // Timestamps come back from Postgres as "2026-07-31 12:44:29.962", with a
  // space and no zone. Read as local time they drift by the offset.
  it("reads a space-separated UTC timestamp as UTC", () => {
    const stamp = new Date(NOW - 40 * 86_400_000).toISOString().replace("T", " ").replace("Z", "");
    expect(staleness(manual(stamp), NOW)).toEqual({ days: 40, kind: "import" });
  });

  it("says nothing when the timestamp is unreadable, rather than guessing", () => {
    expect(staleness(manual("not a date"), NOW)).toBeNull();
  });
});

/**
 * A loan repayment is the one transaction in the app that has to be two facts
 * at once: money left the current account, and what is owed went down. These
 * cover both halves and, just as importantly, that neither is counted twice.
 */
describe("accountTxSums with repayments", () => {
  const AIB = "aib";
  const LOAN = "loan";
  const accounts = [account(AIB), account(LOAN)];
  const payment = {
    account_id: AIB,
    booking_date: "2026-11-01",
    amount: -383.87,
    repays_account_id: LOAN,
  };

  it("takes the payment off the funding account and off what is owed", () => {
    const sums = accountTxSums(accounts, [payment]);
    expect(sums.get(AIB)).toBeCloseTo(-383.87);
    // Positive against a liability, whose balance is negative: paying a debt
    // moves it towards zero.
    expect(sums.get(LOAN)).toBeCloseTo(383.87);
  });

  it("leaves an ordinary transaction alone", () => {
    const sums = accountTxSums(accounts, [{ account_id: AIB, booking_date: "2026-11-01", amount: -20 }]);
    expect(sums.get(AIB)).toBeCloseTo(-20);
    expect(sums.has(LOAN)).toBe(false);
  });

  // The loan's own balance was entered on a date; payments before it are
  // already inside that figure, and counting them again pays it off twice.
  it("honours the loan's own anchor, not the funding account's", () => {
    const anchored = [
      account(AIB),
      { ...account(LOAN), balance_is_manual: true, balance_synced_at: "2026-11-05T00:00:00Z" } as Account,
    ];
    const sums = accountTxSums(anchored, [payment]);
    expect(sums.get(AIB)).toBeCloseTo(-383.87);
    expect(sums.has(LOAN)).toBe(false);
  });

  it("never mirrors a payment onto the account it is already on", () => {
    const sums = accountTxSums(accounts, [{ ...payment, account_id: LOAN }]);
    expect(sums.get(LOAN)).toBeCloseTo(-383.87);
  });
});

describe("spendingTransactions and repaymentMirrors", () => {
  const rows = [
    { account_id: "aib", amount: -383.87, repays_account_id: "loan" },
    { account_id: "aib", amount: -20, repays_account_id: null },
    { account_id: "aib", amount: 2000, repays_account_id: null },
  ];

  it("keeps a repayment out of spending", () => {
    expect(spendingTransactions(rows).map((r) => r.amount)).toEqual([-20, 2000]);
  });

  // The two halves together are what make paying a debt net to nothing, which
  // is the truth: it leaves you exactly as wealthy as you were.
  it("mirrors the repayment so net worth is unchanged by it", () => {
    const mirrors = repaymentMirrors(rows);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({ account_id: "loan", amount: 383.87, repays_account_id: null });
    const net = [...rows, ...mirrors].reduce((sum, r) => sum + r.amount, 0);
    expect(net).toBeCloseTo(1980);
  });

  it("produces no mirror when nothing is a repayment", () => {
    expect(repaymentMirrors([{ account_id: "aib", amount: -20 }])).toEqual([]);
  });
});
