import { describe, expect, it } from "vitest";
import { pairDuplicates, type ExistingTransaction } from "./statementMatch.js";

function existing(rows: [string, number, string][]): ExistingTransaction[] {
  return rows.map(([booking_date, amount, description], i) => ({
    id: `t${i}`,
    booking_date,
    amount,
    description,
    counterparty: null,
  }));
}

describe("duplicate detection at import", () => {
  it("flags a row already on the account", () => {
    const matches = pairDuplicates(
      [{ date: "2026-07-27", amount: -42.15 }],
      existing([["2026-07-27", -42.15, "TESCO STORES"]])
    );
    expect(matches[0]).toMatchObject({ description: "TESCO STORES", amount: -42.15 });
  });

  it("leaves genuinely new rows alone", () => {
    const matches = pairDuplicates(
      [{ date: "2026-07-28", amount: -9.99 }],
      existing([["2026-07-27", -42.15, "TESCO STORES"]])
    );
    expect(matches).toEqual([null]);
  });

  // The whole point of matching on date and amount rather than the content
  // hash: a re-downloaded statement often rewords the description.
  it("matches despite a reworded description", () => {
    const matches = pairDuplicates(
      [{ date: "2026-07-27", amount: -42.15 }],
      existing([["2026-07-27", -42.15, "TESCO STORES 3288  CARD 1373"]])
    );
    expect(matches[0]).not.toBeNull();
  });

  it("does not match on amount alone, or date alone", () => {
    const stored = existing([["2026-07-27", -42.15, "TESCO"]]);
    expect(pairDuplicates([{ date: "2026-07-28", amount: -42.15 }], stored)).toEqual([null]);
    expect(pairDuplicates([{ date: "2026-07-27", amount: -42.16 }], stored)).toEqual([null]);
  });

  // Without one-to-one pairing, a coffee bought twice in a day would have
  // both rows flagged against the single stored one, and the user would skip
  // a payment they actually made.
  it("flags only as many rows as the account actually holds", () => {
    const matches = pairDuplicates(
      [
        { date: "2026-07-27", amount: -3.5 },
        { date: "2026-07-27", amount: -3.5 },
      ],
      existing([["2026-07-27", -3.5, "COFFEE"]])
    );
    expect(matches[0]).not.toBeNull();
    expect(matches[1]).toBeNull();
  });

  it("flags both when the account holds both", () => {
    const matches = pairDuplicates(
      [
        { date: "2026-07-27", amount: -3.5 },
        { date: "2026-07-27", amount: -3.5 },
      ],
      existing([
        ["2026-07-27", -3.5, "COFFEE"],
        ["2026-07-27", -3.5, "COFFEE"],
      ])
    );
    expect(matches.every((m) => m !== null)).toBe(true);
  });

  it("distinguishes money in from money out at the same amount", () => {
    const matches = pairDuplicates(
      [{ date: "2026-07-27", amount: 42.15 }],
      existing([["2026-07-27", -42.15, "TESCO"]])
    );
    expect(matches).toEqual([null]);
  });

  it("handles an empty account", () => {
    expect(pairDuplicates([{ date: "2026-07-27", amount: -1 }], [])).toEqual([null]);
  });
});
