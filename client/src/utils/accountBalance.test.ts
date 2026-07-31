import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { staleness, visibleAccounts, visibleTransactions } from "./accountBalance.js";

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
