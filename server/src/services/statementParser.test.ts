import { describe, expect, it } from "vitest";
import { applyMapping, inferMapping, normaliseAmount, normaliseDate, parseDelimited, parseStatement, splitPreamble } from "./statementParser.js";

// These run without ANTHROPIC_API_KEY, so they exercise the heuristic
// fallback — the path that has to work on its own when no key is configured,
// and the floor the model's answer is checked against.
async function parse(text: string) {
  const { preamble, table } = splitPreamble(parseDelimited(text));
  return applyMapping(table, await inferMapping(table, preamble));
}

describe("statement layouts", () => {
  it("reads UK-style separate debit/credit columns as signed amounts", async () => {
    const rows = await parse(
      ["Date,Description,Paid Out,Paid In", "25/12/2026,TESCO STORES,45.20,", "03/01/2027,SALARY,,2500.00"].join("\n")
    );
    expect(rows).toEqual([
      { date: "2026-12-25", amount: -45.2, description: "TESCO STORES", counterparty: null },
      { date: "2027-01-03", amount: 2500, description: "SALARY", counterparty: null },
    ]);
  });

  it("reads ISO dates with a single signed amount column", async () => {
    const rows = await parse(["date,amount,description", "2026-11-04,-19.99,SPOTIFY"].join("\n"));
    expect(rows[0]).toMatchObject({ date: "2026-11-04", amount: -19.99 });
  });

  // Header names are only a hint: a German export matches none of the English
  // patterns, and a name-only mapping would find no amount column and drop
  // every row.
  it("reads a German export with semicolons, comma decimals and dotted dates", async () => {
    const rows = await parse(
      ["Datum;Beschreibung;Betrag", "31.10.2026;REWE MARKT;-1.234,56", "01.11.2026;GEHALT;2.000,00"].join("\n")
    );
    expect(rows).toEqual([
      { date: "2026-10-31", amount: -1234.56, description: "REWE MARKT", counterparty: null },
      { date: "2026-11-01", amount: 2000, description: "GEHALT", counterparty: null },
    ]);
  });

  it("reads split money-in/money-out columns without recognisable headers", async () => {
    const rows = await parse(
      ["Date;Libelle;Debit;Credit", "05/02/2027;CARREFOUR;12,00;", "06/02/2027;VIREMENT;;900,00"].join("\n")
    );
    expect(rows.map((r) => r.amount)).toEqual([-12, 900]);
  });

  it("keeps a quoted description containing the delimiter intact", async () => {
    const rows = await parse(["Date,Description,Amount", '05/02/2027,"SHOP, THE HIGH ST",-12.00'].join("\n"));
    expect(rows[0]).toMatchObject({ description: "SHOP, THE HIGH ST", amount: -12 });
  });

  it("handles a file with no header row", async () => {
    const rows = await parse(["01/03/2027,COFFEE,-3.50", "02/03/2027,BOOKS,-24.00"].join("\n"));
    expect(rows.map((r) => r.amount)).toEqual([-3.5, -24]);
  });

  // A running-balance column is numeric too; picking it as the amount would
  // import the balance as if it were the transaction.
  it("picks the signed amount column over a running balance column", async () => {
    const rows = await parse(
      ["Date,Description,Amount,Balance", "10/04/2027,RENT,-800.00,1200.00", "11/04/2027,PAY,1500.00,2700.00"].join("\n")
    );
    expect(rows.map((r) => r.amount)).toEqual([-800, 1500]);
  });

  // Real exports open with a title line and an account number before the
  // table. Left in, the first of those looks like the header row and every
  // column index lands on the wrong field.
  it("ignores preamble lines above the header row", async () => {
    const rows = await parse(
      [
        "AIB Personal Current Account Statement",
        "IBAN,IE29AIBK93115212345678",
        "",
        "Posted Date,Description,Debit Amount,Credit Amount,Balance",
        "27/07/2026,TESCO STORES 3288,42.15,,1210.55",
        "25/07/2026,SALARY BARSKE LTD,,3200.00,4410.55",
      ].join("\n")
    );
    expect(rows).toEqual([
      { date: "2026-07-27", amount: -42.15, description: "TESCO STORES 3288", counterparty: null },
      { date: "2026-07-25", amount: 3200, description: "SALARY BARSKE LTD", counterparty: null },
    ]);
  });

  // The correction for an unsigned statement, where money-out is implied by
  // convention rather than written — nothing in the numbers can distinguish
  // that from genuine income, so it's a decision made in the dialog.
  it("flips every amount when invertAmounts is set", async () => {
    const grid = parseDelimited(["Date,Description,Amount", "01/03/2027,COFFEE,3.50", "02/03/2027,BOOKS,24.00"].join("\n"));
    const { table } = splitPreamble(grid);
    const mapping = await inferMapping(table);
    expect(applyMapping(table, mapping).map((r) => r.amount)).toEqual([3.5, 24]);
    expect(applyMapping(table, { ...mapping, invertAmounts: true }).map((r) => r.amount)).toEqual([-3.5, -24]);
  });

  it("skips subtotal rows whose amount cannot be read", async () => {
    const rows = await parse(
      ["Date,Description,Amount", "01/03/2027,COFFEE,-3.50", "01/03/2027,CLOSING BALANCE,"].join("\n")
    );
    expect(rows).toHaveLength(1);
  });
});

describe("normaliseAmount", () => {
  it.each([
    ["(1,234.56)", ".", -1234.56],
    ["45.20 DR", ".", -45.2],
    ["45.20 CR", ".", 45.2],
    ["€1.234,56", ",", 1234.56],
    ["-19.99", ".", -19.99],
  ])("parses %s", (input, separator, expected) => {
    expect(normaliseAmount(input, separator as "." | ",")).toBe(expected);
  });

  it("returns null for a blank cell", () => {
    expect(normaliseAmount("", ".")).toBeNull();
  });

  // Merchant names routinely carry digits. Treating one as a number books a
  // shop's branch code as money, and makes the description column look like
  // the amount column.
  it.each(["TESCO STORES 3288", "SPOTIFY P0F4A9B2C", "CARD 1234", "N/A"])("rejects %s as an amount", (input) => {
    expect(normaliseAmount(input, ".")).toBeNull();
  });

  it("still accepts an amount carrying a currency code", () => {
    expect(normaliseAmount("EUR 42.15", ".")).toBe(42.15);
    expect(normaliseAmount("42.15 EUR", ".")).toBe(42.15);
  });
});

describe("normaliseDate", () => {
  // A day above 12 is unambiguous, and trusting a wrong stated format would
  // silently drop the row as an invalid month.
  it("lets an unambiguous day override the stated format", () => {
    expect(normaliseDate("25/12/2026", "mdy")).toBe("2026-12-25");
  });

  it("respects the stated format when the date is ambiguous", () => {
    expect(normaliseDate("05/06/2026", "dmy")).toBe("2026-06-05");
    expect(normaliseDate("05/06/2026", "mdy")).toBe("2026-05-06");
  });

  it("expands a two-digit year to this century", () => {
    expect(normaliseDate("01/02/27", "dmy")).toBe("2027-02-01");
  });

  it("rejects an impossible date", () => {
    expect(normaliseDate("99/99/2026", "dmy")).toBeNull();
  });

  // PDF statements commonly write "08 Jun" and state the year once at the top.
  it("reads month names, using the document's year when the row omits it", () => {
    expect(normaliseDate("08 Jun", "dmy", 2026)).toBe("2026-06-08");
    expect(normaliseDate("8 June 2025", "dmy", 2026)).toBe("2025-06-08");
    expect(normaliseDate("08-Jun-26", "dmy")).toBe("2026-06-08");
  });

  it("refuses an undated row rather than guessing the year", () => {
    expect(normaliseDate("08 Jun", "dmy")).toBeNull();
  });

  it("rejects a month name that isn't one", () => {
    expect(normaliseDate("08 Xyz 2026", "dmy")).toBeNull();
  });
});

/**
 * Rows that give a day and month but no year take it from the document. Which
 * year is picked decides every date in the import, so the rule matters more
 * than it looks.
 */
describe("year for dates that omit one", () => {
  it("takes the period's year from the header", async () => {
    const { rows } = await parseStatement(
      ["Statement 13 June 2026 to 14 July 2026", "Date,Description,Amount", "15 Jun,TESCO,-12.00", "16 Jun,ALDI,-8.50"].join("\n")
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-06-15", "2026-06-16"]);
  });

  // The failure this guards: a Barclays statement covering June-July 2026
  // carried a 2027 in its small print, and the latest-year-wins rule dated
  // every transaction a year into the future.
  it("ignores a later year mentioned in the small print", async () => {
    const { rows } = await parseStatement(
      [
        "Statement 13 June 2026 to 14 July 2026",
        "Your overdraft rate is fixed until 31 March 2027",
        "Date,Description,Amount",
        "15 Jun,TESCO,-12.00",
      ].join("\n")
    );
    expect(rows[0].date).toBe("2026-06-15");
  });

  it("falls back to a future year when that is all the document offers", async () => {
    // Better a date the document actually states than none at all.
    const { rows } = await parseStatement(["Statement for 2027", "Date,Description,Amount", "15 Jun,TESCO,-12.00"].join("\n"));
    expect(rows[0].date).toBe("2027-06-15");
  });
});
