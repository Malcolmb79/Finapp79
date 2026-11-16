import { describe, expect, it } from "vitest";
import type { Account, TransactionRule } from "../api/client.js";
import { distinctiveWords, unclaimedRepayments } from "./loanRepayments.js";
import { recurringRepayments, subscriptions } from "./recurring.js";

const account = (over: Partial<Account> = {}): Account =>
  ({
    id: "loan1",
    name: "Novuna",
    currency: "GBP",
    source: "manual",
    account_type: "loan",
    ...over,
  }) as Account;

const tx = (over: Partial<Parameters<typeof subscriptions>[0][number]> = {}) => ({
  account_id: "aib",
  amount: -187.24,
  booking_date: "2026-09-02",
  description: "Direct Debit to NOVUNA PERSONAL FINANCE",
  counterparty: null,
  repays_account_id: null,
  ...over,
});

/** A payment on the first of three consecutive months, as a subscription is. */
const monthly = (over: Partial<ReturnType<typeof tx>> = {}) =>
  ["2026-07-02", "2026-08-02", "2026-09-02"].map((booking_date) => tx({ booking_date, ...over }));

describe("subscriptions", () => {
  /**
   * The whole point. A loan instalment is as regular as Netflix and is not the
   * same kind of thing: it buys down a balance rather than paying for
   * something, and it cannot be cancelled — which is the question the list
   * exists to answer.
   */
  it("leaves out a payment already attributed to a loan", () => {
    const charges = monthly({ repays_account_id: "loan1" });
    expect(subscriptions(charges)).toEqual([]);
    expect(recurringRepayments(charges)).toHaveLength(1);
  });

  it("keeps a payment that repays nothing", () => {
    const found = subscriptions(monthly({ description: "NETFLIX.COM", amount: -25.99 }));
    expect(found).toHaveLength(1);
    expect(found[0].monthly).toBeCloseTo(25.99);
  });

  // Both halves of the split, so the card can state what it left out rather
  // than quietly totalling less than the account it came from.
  it("splits one list into the two kinds without losing either", () => {
    const charges = [...monthly({ repays_account_id: "loan1" }), ...monthly({ description: "NETFLIX.COM", amount: -25.99 })];
    expect(subscriptions(charges).map((p) => p.label)).toEqual(["Netflix.com"]);
    expect(recurringRepayments(charges)).toHaveLength(1);
  });
});

describe("distinctiveWords", () => {
  /**
   * Every account of this type carries the words that name the type, so
   * matching on one would attach "Personal loan" to the first payment with
   * the word "personal" in it — which, on a lender's direct debit, is most of
   * them.
   */
  it("ignores the words that name the kind of thing", () => {
    expect(distinctiveWords("Novuna Personal Loan")).toEqual(["novuna"]);
    expect(distinctiveWords("Credit Card")).toEqual([]);
    expect(distinctiveWords("Personal loan")).toEqual([]);
  });

  // A shorter run turns up inside longer words by accident.
  it("ignores a run too short to recognise an account by", () => {
    expect(distinctiveWords("AIB Loan")).toEqual([]);
  });
});

describe("unclaimedRepayments", () => {
  const rule = (over: Partial<TransactionRule> = {}): TransactionRule =>
    ({ id: "r1", match_text: "NOVUNA", match_account_id: null, repays_account_id: "loan1", category_id: null, ...over }) as TransactionRule;

  it("offers a loan nothing is repaying beside a payment carrying its name", () => {
    const payments = subscriptions(monthly());
    const [hit] = unclaimedRepayments(payments, [account()], []);
    expect(hit.account.name).toBe("Novuna");
    expect(hit.matchText).toBe("novuna");
    // Scoped to the account every charge came from: the same lender's name on
    // a different account is a different arrangement.
    expect(hit.fromAccountId).toBe("aib");
  });

  /**
   * The owner has already answered this question. Asking again because their
   * answer isn't matching anything is a different prompt, and `RepaymentRule`
   * already shows it beside the account.
   */
  it("says nothing about a loan whose repayments are already named", () => {
    expect(unclaimedRepayments(subscriptions(monthly()), [account()], [rule()])).toEqual([]);
  });

  /**
   * Two candidates is not an answer. A lender charging a monthly fee alongside
   * the instalment is the ordinary case, and picking one would be inventing
   * which is which — the same discipline `nameUnnamedRows` uses.
   */
  it("refuses to choose between two payments carrying the same name", () => {
    const payments = subscriptions([...monthly(), ...monthly({ description: "NOVUNA SERVICE FEE", amount: -4.5 })]);
    expect(payments).toHaveLength(2);
    expect(unclaimedRepayments(payments, [account()], [])).toEqual([]);
  });

  // The same ambiguity from the other side, which is what two cards with one
  // bank looks like.
  it("refuses to choose between two loans claiming one payment", () => {
    const payments = subscriptions(monthly({ description: "Direct Debit to NOVUNA RETAIL FINANCE" }));
    const loans = [account({ id: "a", name: "Novuna sofa" }), account({ id: "b", name: "Novuna retail" })];
    expect(unclaimedRepayments(payments, loans, [])).toEqual([]);
  });

  it("says nothing about an account that is not a liability", () => {
    expect(unclaimedRepayments(subscriptions(monthly()), [account({ account_type: "current" })], [])).toEqual([]);
  });

  it("says nothing about a hidden account", () => {
    expect(unclaimedRepayments(subscriptions(monthly()), [account({ hidden: true })], [])).toEqual([]);
  });

  it("says nothing when no payment carries the account's name", () => {
    const payments = subscriptions(monthly({ description: "NETFLIX.COM", amount: -25.99 }));
    expect(unclaimedRepayments(payments, [account()], [])).toEqual([]);
  });

  // Charges arriving on two accounts leave the rule open rather than pinned to
  // whichever happened to come last.
  it("leaves the rule unscoped when the charges disagree on an account", () => {
    const charges = monthly();
    charges[0].account_id = "barclays";
    const [hit] = unclaimedRepayments(subscriptions(charges), [account()], []);
    expect(hit.fromAccountId).toBeNull();
  });
});
