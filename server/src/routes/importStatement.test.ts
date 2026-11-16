import { describe, expect, it } from "vitest";
import { betterDescriptionColumn, importedDescription, isUnnamed } from "./importStatement.js";
import { applyMapping, inferMapping, parseDelimited, splitPreamble, type ParsedRow } from "../services/statementParser.js";

/**
 * The failure these guard against imports perfectly.
 *
 * Every date and every amount lands correctly, the total agrees with the
 * statement, and nothing in a balance or a chart is wrong — the rows simply
 * arrive with no name. It surfaces days later as a review queue of lines
 * reading "Transaction" over a date, unfilable, with nothing left to say
 * which statement they came in on.
 */
async function mapOf(text: string) {
  const { preamble, table } = splitPreamble(parseDelimited(text));
  const mapping = await inferMapping(table, preamble);
  return { table, mapping, rows: applyMapping(table, mapping) };
}

describe("isUnnamed", () => {
  it("is a row with neither a description nor a payee", () => {
    expect(isUnnamed({ date: "2026-11-07", amount: -125, description: null, counterparty: null })).toBe(true);
  });

  it("counts whitespace as nothing, because it reads as nothing", () => {
    expect(isUnnamed({ date: "2026-11-07", amount: -125, description: "   ", counterparty: null })).toBe(true);
  });

  // A payee alone is a name. The row shows it, so it is filable.
  it("is satisfied by either field", () => {
    expect(isUnnamed({ date: "2026-11-07", amount: -125, description: null, counterparty: "TESCO" })).toBe(false);
    expect(isUnnamed({ date: "2026-11-07", amount: -125, description: "TESCO", counterparty: null })).toBe(false);
  });
});

describe("betterDescriptionColumn", () => {
  /**
   * The FNB case, and the reason this guard exists at all.
   *
   * A statement whose rows the description column leaves blank, where the
   * only other column is the running balance. Offering it reads as helpful
   * and is the worst available outcome: every unnamed row becomes
   * "12,381.04", which looks like a row that has been identified and no
   * longer says that anything is missing. Nothing is the right answer.
   */
  it("refuses to offer a balance column", async () => {
    const { table, mapping, rows } = await mapOf(
      [
        "Date,Reference,Amount,Balance",
        "07/11/2026,,-125.00,12381.04",
        "05/11/2026,,-114.62,12266.42",
        "30/10/2026,,-69.00,12197.42",
      ].join("\n")
    );

    const unnamed = rows.filter(isUnnamed).length;
    expect(unnamed).toBe(3);
    expect(betterDescriptionColumn(table, mapping, unnamed)).toBeNull();
  });

  /**
   * A "Reference" column the bank fills on one row in four, sitting beside a
   * column of text the mapping is not using. The row-level fallback in
   * `applyMapping` reaches that text first, so there is nothing left for a
   * column swap to improve — which is the point: a column swap moves every
   * row, and the rows that already had a name did not need moving.
   */
  it("offers nothing once the rows have found their names on their own lines", async () => {
    const { table, mapping, rows } = await mapOf(
      [
        "Date,Reference,Detail,Amount",
        "07/11/2026,REF88213,Pick n Pay,-125.00",
        "05/11/2026,,Woolworths Food,-114.62",
        "30/10/2026,,Uber Trip Johannesburg,-69.00",
        "27/10/2026,,Bank Charge,-2.00",
      ].join("\n")
    );

    expect(rows.map((r) => r.description)).toEqual([
      "REF88213",
      "Woolworths Food",
      "Uber Trip Johannesburg",
      "Bank Charge",
    ]);
    expect(rows.filter(isUnnamed)).toHaveLength(0);
    expect(betterDescriptionColumn(table, mapping, 0)).toBeNull();
  });

  // Nothing to suggest, and suggesting anyway would move a mapping that was
  // already right.
  it("offers nothing when every row is already named", async () => {
    const { table, mapping, rows } = await mapOf(
      ["Date,Description,Amount", "07/11/2026,Pick n Pay,-125.00", "05/11/2026,Woolworths,-114.62"].join("\n")
    );
    expect(rows.filter(isUnnamed)).toHaveLength(0);
    expect(betterDescriptionColumn(table, mapping, 0)).toBeNull();
  });

  /**
   * A handful of unnamed rows is ordinary — bank charges and interest often
   * carry no narrative at all — and no other column names them either. The
   * suggestion has to be silent there rather than proposing the date or a
   * balance column as a description.
   */
  it("offers nothing when no other column would name more", async () => {
    const { table, mapping, rows } = await mapOf(
      [
        "Date,Description,Amount",
        "07/11/2026,Pick n Pay,-125.00",
        "05/11/2026,,-2.00",
        "30/10/2026,Woolworths,-69.00",
      ].join("\n")
    );
    const unnamed = rows.filter(isUnnamed).length;
    expect(unnamed).toBe(1);
    expect(betterDescriptionColumn(table, mapping, unnamed)).toBeNull();
  });

  /**
   * Never the date or the amount, even when the statement genuinely names
   * nothing. Those columns are spoken for, and proposing one would trade a
   * queue of unnamed rows for a queue of rows named "-125.00" — which looks
   * fixed and is worse, because it no longer announces that anything is
   * missing.
   */
  it("proposes nothing rather than a column the mapping is already using", async () => {
    const { table, mapping, rows } = await mapOf(
      ["Date,Detail,Amount", "07/11/2026,,-125.00", "05/11/2026,,-114.62"].join("\n")
    );
    expect(rows.filter(isUnnamed)).toHaveLength(2);
    expect(betterDescriptionColumn(table, mapping, 2)).toBeNull();
  });
});

describe("importedDescription", () => {
  const row = (description: string | null): ParsedRow => ({
    date: "2026-10-27",
    amount: -2,
    description,
    counterparty: null,
  });

  /**
   * The FNB fee lines. The PDF's text layer has no run at all in the
   * description column on those rows — not text in the wrong column, nothing
   * — so no mapping produces a name and typing it during the import is the
   * only way one is ever going to be there.
   */
  it("takes the typed name for a row the file doesn't name", () => {
    expect(importedDescription(row(null), "Service Fee")).toBe("Service Fee");
  });

  // The statement's own wording is the record. A box left over from an
  // earlier mapping, when this row was blank and now isn't, must not win.
  it("never overrides what the statement says", () => {
    expect(importedDescription(row("Int On Debit Balance"), "Service Fee")).toBe("Int On Debit Balance");
  });

  it("leaves a row the owner didn't name alone", () => {
    expect(importedDescription(row(null), "")).toBeNull();
    expect(importedDescription(row(null), "   ")).toBeNull();
    expect(importedDescription(row(null), undefined)).toBeNull();
  });
});
