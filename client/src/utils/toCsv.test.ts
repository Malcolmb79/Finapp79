import { describe, expect, it } from "vitest";
import { csvCell, toCsv, transactionsToCsv } from "./toCsv.js";

/**
 * A file that opens in a spreadsheet is a file that can run things, and the
 * descriptions in it came from outside — a bank feed, a statement somebody was
 * sent. That is the failure worth testing for here; a misplaced comma only
 * produces a mess, while a cell beginning with `=` produces a formula.
 */

describe("csvCell", () => {
  it("quotes every cell", () => {
    expect(csvCell("Example Shop")).toBe('"Example Shop"');
  });

  it("survives the characters CSV cares about", () => {
    expect(csvCell('Say "hello"')).toBe('"Say ""hello"""');
    expect(csvCell("Shop, Dublin")).toBe('"Shop, Dublin"');
    expect(csvCell("Two\nlines")).toBe('"Two\nlines"');
  });

  /**
   * The one that matters. A spreadsheet reads a leading =, +, - or @ as a
   * formula, so a payee named "=SUM(A1:A9)" becomes live content the moment
   * the file is opened. The apostrophe marks it as text and is not displayed.
   */
  it("defuses a cell a spreadsheet would run", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("\"'=SUM(A1:A9)\"");
    expect(csvCell("+1+1")).toBe("\"'+1+1\"");
    expect(csvCell("@import")).toBe("\"'@import\"");
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
  });

  it("leaves an ordinary cell alone", () => {
    expect(csvCell("Tesco 2 for 1")).toBe('"Tesco 2 for 1"');
  });

  /**
   * Every outgoing amount begins with a minus. Guarding on the leading
   * character alone turned the whole Amount column into text, and a column
   * of text sums to zero without saying so - a worse failure than the one
   * the guard prevents.
   */
  it("leaves a negative number addable", () => {
    expect(csvCell("-12.87")).toBe('"-12.87"');
    expect(csvCell(-12.87)).toBe('"-12.87"');
    // Still defused: this is not a number.
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
  });

  it("writes nothing for nothing", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a header and rows", () => {
    expect(toCsv(["A", "B"], [[1, 2]])).toBe('"A","B"\r\n"1","2"');
  });
});

describe("transactionsToCsv", () => {
  const tx = {
    booking_date: "2026-11-10",
    description: "Example Shop",
    counterparty: null,
    amount: -12.87,
    currency: "EUR",
    account_id: "a1",
    category_id: 1,
    source: "enablebanking",
  };

  const accountName = (id: string) => (id === "a1" ? "Current account" : undefined);
  const categoryName = (id: number | null) => (id === 1 ? "Groceries" : null);

  it("resolves the names a spreadsheet cannot look up", () => {
    const csv = transactionsToCsv([tx], accountName, categoryName);
    expect(csv).toContain('"Current account"');
    expect(csv).toContain('"Groceries"');
    // Not the raw ids, which mean nothing outside this app.
    expect(csv).not.toContain("a1");
  });

  /**
   * The amount has to be a number a spreadsheet can total. "-€12.87" is text,
   * and a column of text sums to zero without saying so.
   */
  it("writes an amount that adds up", () => {
    expect(transactionsToCsv([tx], accountName, categoryName)).toContain('"-12.87"');
  });

  it("writes an empty cell rather than the word null", () => {
    const bare = { ...tx, description: null, counterparty: null, category_id: null };
    const csv = transactionsToCsv([bare], accountName, categoryName);
    expect(csv).not.toContain("null");
  });

  it("writes a header even when there is nothing to export", () => {
    expect(transactionsToCsv([], accountName, categoryName)).toBe(
      '"Date","Description","Payee","Amount","Currency","Account","Category","Source"'
    );
  });
});
