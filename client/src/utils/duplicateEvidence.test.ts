import { describe, expect, it } from "vitest";
import type { Transaction } from "../api/client.js";
import { copyEvidence, duplicateEvidence, STRENGTH_ORDER } from "./duplicateEvidence.js";
import type { DuplicateGroup } from "./findDuplicates.js";

/**
 * The screen offers to delete somebody's transactions, so what this says about
 * a pair is what stands between an ordinary Tuesday and a payment quietly
 * disappearing. The case that matters most is the weak one: two shops that
 * charged the same amount on the same day have to be called out, not merely
 * ranked lower.
 */

let n = 0;
const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: `t${++n}`,
    account_id: "a1",
    booking_date: "2026-11-10",
    amount: -15.99,
    currency: "EUR",
    description: "Example Shop",
    counterparty: null,
    category_id: null,
    source: "enablebanking",
    created_at: "2026-11-10T09:00:00Z",
    reviewed_at: "2026-11-10T09:00:00Z",
    ...over,
  }) as Transaction;

const group = (kind: DuplicateGroup["kind"], original: Transaction, ...copies: Transaction[]): DuplicateGroup => ({
  kind,
  original,
  copies,
});

describe("duplicateEvidence", () => {
  it("calls a merchant cut short a day apart near certain", () => {
    const e = duplicateEvidence(
      group(
        "days-apart",
        tx({ booking_date: "2026-11-11", description: "shop.example.com Purchase" }),
        tx({ booking_date: "2026-11-12", description: "VDP-shop.example.co Purchase" })
      )
    );
    expect(e.strength).toBe("near-certain");
  });

  it("calls an identical same-day pair likely, and still says two purchases look like this", () => {
    const e = duplicateEvidence(group("same-day", tx(), tx()));
    expect(e.strength).toBe("likely");
    expect(e.note).toMatch(/two separate purchases/i);
  });

  /**
   * The pair that would cost a real payment. Two different merchants, same
   * day, same amount — flagged by the date-and-amount rule and nothing else.
   */
  it("calls two different descriptions on one day weak, and says why", () => {
    const e = duplicateEvidence(
      group("same-day", tx({ description: "VDP-Examplebank**1234* Purchase" }), tx({ description: "VDP-Othershop Purchase" }))
    );
    expect(e.strength).toBe("weak");
    expect(e.note).toMatch(/different things/i);
  });

  // The same name written two ways on one day is still one merchant.
  it("lifts a same-day pair whose descriptions name one merchant", () => {
    const e = duplicateEvidence(
      group("same-day", tx({ description: "shop.example.com Purchase" }), tx({ description: "VDP-shop.example.co Purchase" }))
    );
    expect(e.strength).toBe("likely");
  });

  it("copes with a group that lost its copy", () => {
    expect(duplicateEvidence(group("same-day", tx())).strength).toBe("weak");
  });

  /**
   * The shape that exposed group-level grading: three rows that match each
   * other and one from somewhere else. Judged as a group it was "probably
   * not", which is wrong about three of them, and the decision is taken one
   * row at a time anyway.
   */
  it("judges each copy on its own, not the group on its weakest", () => {
    const original = tx({ description: "Example Shop" });
    const twin = tx({ description: "Example Shop" });
    const stranger = tx({ description: "Somewhere Else" });
    expect(copyEvidence(original, twin, "same-day").strength).toBe("likely");
    expect(copyEvidence(original, stranger, "same-day").strength).toBe("weak");
    // The group still sorts by its strongest, so the easy decision is near
    // the top of the list rather than buried.
    expect(duplicateEvidence(group("same-day", original, twin, stranger)).strength).toBe("likely");
  });

  it("orders the strong evidence first", () => {
    const order = (["weak", "near-certain", "likely"] as const).slice().sort((a, b) => STRENGTH_ORDER[a] - STRENGTH_ORDER[b]);
    expect(order).toEqual(["near-certain", "likely", "weak"]);
  });
});
