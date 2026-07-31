import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { visibleAccounts, visibleTransactions } from "./accountBalance.js";

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
