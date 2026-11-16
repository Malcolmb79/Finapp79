import { describe, expect, it } from "vitest";
import type { Category, Policy } from "../api/client.js";
import { classifyCommitments, groupCommitments, sharedToken, UNFILED } from "./commitments.js";
import { subscriptions } from "./recurring.js";

const charges = (over: { description?: string; amount?: number; category_id?: number | null } = {}) =>
  ["2026-07-02", "2026-08-03", "2026-09-02"].map((booking_date, i) => ({
    account_id: "aib",
    booking_date,
    amount: over.amount ?? -95.9,
    // A mandate reference that differs every month, which is what a real
    // description carries and what `sharedToken` has to see past.
    description: `${over.description ?? "Direct Debit to AVIVA"} ${100 + i}`,
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

const read = (payments: Parameters<typeof classifyCommitments>[0], ctx?: Parameters<typeof classifyCommitments>[1]) =>
  classifyCommitments(payments, ctx).map((c) => [c.payment.label, c.group, c.readFrom]);

describe("classifyCommitments", () => {
  /**
   * The rule, rather than a list of kinds. "Utilities" appears because
   * somebody typed "Utilities" — which generalises to the gym and the creche
   * and the bins for free, and cannot be wrong about a merchant it has never
   * heard of, because it never looks at merchants.
   */
  it("files a payment under the category the owner filed it under", () => {
    const found = read(subscriptions(charges({ description: "TALKTALK TELECOM", category_id: 4 })), {
      categories: [category(4, "Utilities")],
    });
    expect(found).toEqual([["Talktalk Telecom 102", "Utilities", null]]);
  });

  it("asks rather than guesses when nothing has been filed", () => {
    expect(read(subscriptions(charges({ description: "TALKTALK TELECOM" })))).toEqual([
      ["Talktalk Telecom 102", UNFILED, null],
    ]);
  });

  /**
   * The one reading that earns itself: a premium matched to a policy the
   * owner holds is evidence from two independent places. Named on the row, so
   * a wrong reading can be seen and argued with.
   */
  it("reads a premium from a policy where nothing was filed", () => {
    expect(read(subscriptions(charges()), { policies: [policy()] })).toEqual([
      ["Direct Debit to AVIVA 102", "Insurance", "Family cover"],
    ]);
  });

  // A reading must never overrule a decision somebody actually made.
  it("prefers what was filed over what can be read", () => {
    const found = read(subscriptions(charges({ category_id: 9 })), {
      policies: [policy()],
      categories: [category(9, "Health")],
    });
    expect(found).toEqual([["Direct Debit to AVIVA 102", "Health", null]]);
  });

  /**
   * Both tests have to pass. An insurer that also sells you car cover appears
   * in plenty of unrelated debits, and a round monthly figure matches half a
   * statement.
   */
  it("needs the amount as well as the name", () => {
    expect(read(subscriptions(charges({ description: "AVIVA HEALTH SHOP", amount: -12 })), { policies: [policy()] })[0][1]).toBe(
      UNFILED
    );
  });

  it("needs the name as well as the amount", () => {
    expect(read(subscriptions(charges({ description: "SPOTIFY", amount: -95.9 })), { policies: [policy()] })[0][1]).toBe(UNFILED);
  });

  // Every policy is a "life cover plan" of some sort, so matching on one of
  // those words would read any payment mentioning life as a premium.
  it("will not match on the words every policy carries", () => {
    const found = read(subscriptions(charges({ description: "LIFE COVER PLAN LTD" })), {
      policies: [policy({ insurer: null, name: "Life cover" })],
    });
    expect(found[0][1]).toBe(UNFILED);
  });

  // Somebody holding two policies with one insurer at a similar premium is
  // ordinary, and naming one puts a label on the row that may be wrong.
  it("refuses to choose between two policies that both fit", () => {
    const found = read(subscriptions(charges()), {
      policies: [policy({ id: "a", name: "His" }), policy({ id: "b", name: "Hers" })],
    });
    expect(found[0][1]).toBe(UNFILED);
  });
});

describe("groupCommitments", () => {
  const mixed = () =>
    subscriptions([
      ...charges({ description: "TALKTALK TELECOM", amount: -76.38, category_id: 4 }),
      ...charges({ description: "NETFLIX.COM", amount: -25.99, category_id: 5 }),
      ...charges({ description: "ANTHROPIC CLAUDE", amount: -22.14 }),
    ]);

  it("gathers each kind under its own heading with its own total", () => {
    const groups = groupCommitments(
      classifyCommitments(mixed(), { categories: [category(4, "Utilities"), category(5, "Subscriptions")] })
    );
    expect(groups.map((g) => [g.name, Math.round(g.monthly * 100) / 100])).toEqual([
      ["Utilities", 76.38],
      ["Subscriptions", 25.99],
      [UNFILED, 22.14],
    ]);
  });

  /**
   * Pinned last whatever it costs. It is the only heading that is a question
   * rather than an answer, and a question at the top of a card reads as the
   * card's main finding.
   */
  it("keeps the unanswered heading at the bottom even when it is the dearest", () => {
    const groups = groupCommitments(
      classifyCommitments(
        subscriptions([
          ...charges({ description: "TALKTALK TELECOM", amount: -10, category_id: 4 }),
          ...charges({ description: "ANTHROPIC CLAUDE", amount: -900 }),
        ]),
        { categories: [category(4, "Utilities")] }
      )
    );
    expect(groups.map((g) => g.name)).toEqual(["Utilities", UNFILED]);
  });
});

describe("sharedToken", () => {
  /**
   * The text a standing rule can safely be built on. It has to be in every
   * one of this merchant's own descriptions as the bank wrote them — a token
   * present in only some of them describes a payment that merely groups
   * alongside, and a rule on it would file things nobody looked at.
   */
  it("takes a word every charge carries, not one only some do", () => {
    const [payment] = subscriptions(charges({ description: "TALKTALK TELECOM" }));
    expect(sharedToken(payment)).toBe("talktalk");
  });

  // The longest is the most specific: "talktalk" over "telecom", which is a
  // word half a statement carries.
  it("prefers the most specific word available", () => {
    const [payment] = subscriptions(charges({ description: "VODAFONE LTD TELECOM" }));
    expect(sharedToken(payment)).toBe("vodafone");
  });

  // The mandate reference differs every month, so it is in no shared text.
  it("never offers the reference that changes every month", () => {
    const [payment] = subscriptions(charges({ description: "TALKTALK TELECOM" }));
    expect(sharedToken(payment)).not.toMatch(/\d/);
  });

  // Nothing offered rather than a rule whose text was invented.
  it("says nothing when no word qualifies", () => {
    const [payment] = subscriptions(
      ["2026-07-02", "2026-08-03", "2026-09-02"].map((booking_date, i) => ({
        account_id: "aib",
        booking_date,
        amount: -10,
        description: `Direct Debit ${i}`,
        counterparty: null,
      }))
    );
    expect(sharedToken(payment)).toBeNull();
  });
});
