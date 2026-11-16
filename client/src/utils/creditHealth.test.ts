import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { creditHealth, utilisationNote, utilisationTone } from "./creditHealth.js";

const money = (value: number) => `€${value.toFixed(0)}`;

const account = (over: Partial<Account>): Account =>
  ({ id: "a", name: "Card", currency: "EUR", source: "manual", account_type: "credit_card", ...over }) as Account;

describe("creditHealth", () => {
  const card = account({ id: "c1", name: "Visa", overdraft_limit: 4000 });
  const other = account({ id: "c2", name: "Amex", overdraft_limit: 6000 });

  it("divides what is drawn by the limit, per card and overall", () => {
    const health = creditHealth([card, other], new Map([["c1", -3000], ["c2", -1000]]));
    expect(health.cards.find((c) => c.account.id === "c1")?.utilisation).toBe(0.75);
    expect(health.cards.find((c) => c.account.id === "c2")?.utilisation).toBeCloseTo(0.1667, 3);
    expect(health.overall).toBe(0.4);
  });

  /**
   * Lenders read each account as well as the aggregate, so one card at
   * ninety-five per cent drags a file down while the overall figure still
   * looks respectable. The strained list is that fact made visible.
   */
  it("names the cards a lender would look at individually", () => {
    const health = creditHealth([card, other], new Map([["c1", -3800], ["c2", -200]]));
    expect(health.overall).toBeCloseTo(0.4, 2);
    expect(health.strained.map((c) => c.account.name)).toEqual(["Visa"]);
  });

  /**
   * A mortgage at ninety per cent of its original value is not a household
   * using ninety per cent of its credit. An instalment loan has no revolving
   * limit, and including it would make everybody who has bought a house look
   * maxed out.
   */
  it("counts revolving credit only", () => {
    const loan = account({ id: "l1", account_type: "loan", overdraft_limit: 300000 });
    const savings = account({ id: "s1", account_type: "savings" });
    const health = creditHealth([card, loan, savings], new Map([["c1", -1000], ["l1", -280000]]));
    expect(health.cards).toHaveLength(1);
    expect(health.totalLimit).toBe(4000);
  });

  // An arranged overdraft is a limit that can be drawn and repaid at will,
  // which is the test.
  it("counts an arranged overdraft, and ignores a current account without one", () => {
    const overdrawn = account({ id: "o1", account_type: "current", overdraft_limit: 2000 });
    const plain = account({ id: "p1", account_type: "current" });
    const health = creditHealth([overdrawn, plain], new Map([["o1", -500]]));
    expect(health.cards.map((c) => c.account.id)).toEqual(["o1"]);
    expect(health.overall).toBe(0.25);
  });

  it("treats a card in credit as owing nothing", () => {
    const health = creditHealth([card], new Map([["c1", 250]]));
    expect(health.cards[0].drawn).toBe(0);
    expect(health.cards[0].utilisation).toBe(0);
    expect(health.cards[0].headroom).toBe(4000);
  });

  // A total that silently treated an unknown limit as zero would be dividing
  // by a figure nobody entered.
  it("counts the cards whose limit it could not see", () => {
    const noLimit = account({ id: "c3", name: "Store card" });
    const health = creditHealth([card, noLimit], new Map([["c1", -1000], ["c3", -500]]));
    expect(health.unknownLimits).toBe(1);
    expect(health.totalLimit).toBe(4000);
    expect(health.totalDrawn).toBe(1000);
    expect(health.cards.find((c) => c.account.id === "c3")?.utilisation).toBeNull();
  });

  it("has no overall figure when no limit is known anywhere", () => {
    expect(creditHealth([account({ id: "c3" })], new Map([["c3", -500]])).overall).toBeNull();
  });

  it("puts the worst card first, which is the one worth acting on", () => {
    const health = creditHealth([other, card], new Map([["c1", -3800], ["c2", -600]]));
    expect(health.cards[0].account.name).toBe("Visa");
  });
});

describe("utilisation wording", () => {
  const card = account({ id: "c1", name: "Visa", overdraft_limit: 4000 });

  /**
   * "72%" is a diagnosis; "pay €840 off this card" is something somebody can
   * actually do this afternoon.
   */
  it("names the amount that would fix it rather than only the percentage", () => {
    const [strained] = creditHealth([card], new Map([["c1", -3000]])).cards;
    expect(strained.toGood).toBe(1800);
    expect(utilisationNote(strained, money)).toContain("€1800");
    expect(utilisationNote(strained, money)).toContain("under 30%");
  });

  it("says plainly when there is nothing to fix", () => {
    const [clear] = creditHealth([card], new Map([["c1", 0]])).cards;
    expect(utilisationNote(clear, money)).toBe("Nothing owed on it.");
  });

  it("points at the missing limit rather than reporting a figure it cannot have", () => {
    const [unknown] = creditHealth([account({ id: "c3" })], new Map([["c3", -500]])).cards;
    expect(utilisationNote(unknown, money)).toContain("No credit limit recorded");
  });

  it("tones the figure the way the advice reads", () => {
    expect(utilisationTone(0.05)).toBe("good");
    expect(utilisationTone(0.28)).toBe("good");
    expect(utilisationTone(0.5)).toBe("warning");
    expect(utilisationTone(0.9)).toBe("critical");
    expect(utilisationTone(null)).toBe("muted");
  });
});
