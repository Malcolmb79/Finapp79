import { describe, expect, it } from "vitest";
import { applyMapping, inferMapping, normaliseAmount, normaliseDate, parseDelimited } from "./statementParser.js";

// These run without ANTHROPIC_API_KEY, so they exercise the heuristic
// fallback — the path that has to work on its own when no key is configured,
// and the floor the model's answer is checked against.
async function parse(text: string) {
  const grid = parseDelimited(text);
  return applyMapping(grid, await inferMapping(grid));
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
});
