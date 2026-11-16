import { describe, expect, it } from "vitest";
import type { Category, Policy } from "../api/client.js";
import { classifyCommitments, monthlyTotal, ofKind } from "./commitments.js";
import { subscriptions } from "./recurring.js";

const charges = (over: { description?: string; amount?: number; category_id?: number | null } = {}) =>
  ["2026-07-02", "2026-08-03", "2026-09-02"].map((booking_date) => ({
    account_id: "aib",
    booking_date,
    amount: over.amount ?? -95.9,
    description: over.description ?? "Direct Debit to AVIVA",
    counterparty: null,
    category_id: over.category_id ?? null,
    repays_account_id: null,
  }));

const policy = (over: Partial<Policy> = {}): Policy =>
  ({
    id: "p1",
    name: "Family cover",
    insurer: "Aviva",
    currency: "EUR",
    premium: 95.9,
    premium_frequency: "monthly",
    net_worth_source: "none",
    ...over,
  }) as Policy;

const category = (id: number, name: string): Category => ({ id, name, parent_id: null });

const kinds = (payments: Parameters<typeof classifyCommitments>[0], ctx?: Parameters<typeof classifyCommitments>[1]) =>
  classifyCommitments(payments, ctx).map((c) => [c.payment.label, c.kind, c.because]);

describe("classifyCommitments", () => {
  /**
   * The whole point. Cancelling Netflix costs you Netflix; cancelling cover
   * costs you the cover. A premium quoted inside a total headed "what you
   * could stop paying for" invites the one conclusion this card must not lead
   * anybody to.
   */
  it("reads a premium as insurance from a policy the owner holds", () => {
    expect(kinds(subscriptions(charges()), { policies: [policy()] })).toEqual([["Direct Debit to AVIVA", "insurance", "Family cover"]]);
  });

  // Somebody typing "Insurance" on a transaction has already answered this,
  // and better than this file could — which is what covers car and home
  // cover, neither of which is in the policies table at all.
  it("reads it from the category the owner filed it under", () => {
    const found = kinds(subscriptions(charges({ category_id: 7 })), { categories: [category(7, "Insurance")] });
    expect(found).toEqual([["Direct Debit to AVIVA", "insurance", "Insurance"]]);
  });

  it("leaves an ordinary subscription alone", () => {
    const found = kinds(subscriptions(charges({ description: "NETFLIX.COM", amount: -25.99 })), { policies: [policy()] });
    expect(found).toEqual([["Netflix.com", "subscription", null]]);
  });

  /**
   * Both tests have to pass. An insurer that also sells you car cover appears
   * in plenty of unrelated debits, and a round monthly figure matches half a
   * statement.
   */
  it("needs the amount as well as the name", () => {
    const found = kinds(subscriptions(charges({ description: "AVIVA HEALTH SHOP", amount: -12 })), { policies: [policy()] });
    expect(found[0][1]).toBe("subscription");
  });

  it("needs the name as well as the amount", () => {
    const found = kinds(subscriptions(charges({ description: "SPOTIFY", amount: -95.9 })), { policies: [policy()] });
    expect(found[0][1]).toBe("subscription");
  });

  /**
   * Words naming the kind of thing identify nothing: every policy is a "life
   * cover plan" of some sort, and matching on one would read any payment
   * mentioning life as a premium.
   */
  it("will not match on the words every policy carries", () => {
    const found = kinds(subscriptions(charges({ description: "LIFE COVER PLAN LTD" })), {
      policies: [policy({ insurer: null, name: "Life cover" })],
    });
    expect(found[0][1]).toBe("subscription");
  });

  /**
   * Two policies fitting one payment is not an answer. Somebody holding two
   * policies with one insurer at a similar premium is ordinary, and naming one
   * puts a label on the row that may be the wrong one.
   */
  it("refuses to choose between two policies that both fit", () => {
    const found = kinds(subscriptions(charges()), {
      policies: [policy({ id: "a", name: "His" }), policy({ id: "b", name: "Hers" })],
    });
    expect(found[0][1]).toBe("subscription");
  });

  // A category has to say this and nothing else. A cover charge is a night
  // out, and a reading that is quietly wrong just moves the row to a
  // different heading with nothing to announce it.
  it("does not read every category that mentions cover as insurance", () => {
    const found = kinds(subscriptions(charges({ category_id: 7 })), { categories: [category(7, "Cover charges")] });
    expect(found[0][1]).toBe("subscription");
  });

  it("says nothing without a policy or a category to read", () => {
    expect(kinds(subscriptions(charges()))).toEqual([["Direct Debit to AVIVA", "subscription", null]]);
  });
});

describe("ofKind and monthlyTotal", () => {
  it("splits the list and totals each side", () => {
    const payments = subscriptions([...charges(), ...charges({ description: "NETFLIX.COM", amount: -25.99 })]);
    const commitments = classifyCommitments(payments, { policies: [policy()] });
    expect(monthlyTotal(ofKind(commitments, "insurance"))).toBeCloseTo(95.9);
    expect(monthlyTotal(ofKind(commitments, "subscription"))).toBeCloseTo(25.99);
  });
});
