import { describe, expect, it } from "vitest";
import { betterDescriptionColumn, isUnnamed } from "./importStatement.js";
import { applyMapping, inferMapping, parseDelimited, splitPreamble } from "../services/statementParser.js";

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
   * The shape that causes it: a "Reference" column the bank fills on one row
   * in four, sitting beside the column that actually names every row. The
   * header name wins — "reference" is one of the words a description column
   * is recognised by — and the rows it leaves blank import nameless.
   *
   * A column empty on *every* row is caught earlier, in the mapping itself
   * (see statementParser.test.ts). This is the half-filled case, which no
   * amount of looking at the header can settle.
   */
  it("finds the column that names the rows the mapped one leaves blank", async () => {
    const { table, mapping, rows } = await mapOf(
      [
        "Date,Reference,Detail,Amount",
        "07/11/2026,REF88213,Pick n Pay,-125.00",
        "05/11/2026,,Woolworths Food,-114.62",
        "30/10/2026,,Uber Trip Johannesburg,-69.00",
        "27/10/2026,,Bank Charge,-2.00",
      ].join("\n")
    );

    const unnamed = rows.filter(isUnnamed).length;
    expect(unnamed).toBe(3);

    const better = betterDescriptionColumn(table, mapping, unnamed);
    expect(better).not.toBeNull();
    const fixed = applyMapping(table, { ...mapping, descriptionColumn: better });
    expect(fixed.map((r) => r.description)).toEqual([
      "Pick n Pay",
      "Woolworths Food",
      "Uber Trip Johannesburg",
      "Bank Charge",
    ]);
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
