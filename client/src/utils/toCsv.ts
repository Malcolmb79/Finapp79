/**
 * Transactions out, as a spreadsheet.
 *
 * Everything this app does with somebody's money history, it does inside
 * itself. That is fine until the day they want to do something it does not
 * do — a pivot table, a year-end summary, an accountant's template, or simply
 * keeping a copy somewhere that does not depend on this app continuing to
 * exist. Without an export the answer to all of those is "retype it".
 *
 * Exports what is on screen rather than everything held. Somebody who has
 * filtered to one account and one month and then asks for a file means that
 * month, not their entire history — and the file is the one thing they cannot
 * check at a glance before it lands in a spreadsheet.
 */

/**
 * One cell, quoted so it survives the trip.
 *
 * The prefix guard is the part that is not obvious. A spreadsheet treats a
 * cell beginning `=`, `+`, `-` or `@` as a formula, so a payee called
 * "=SUM(A1:A9)" — or a crafted one in an imported statement — becomes live
 * content when the file is opened. The cell is prefixed with an apostrophe,
 * which spreadsheets read as "this is text" and do not display.
 */
/**
 * A plain decimal number, which must not be defused.
 *
 * Every outgoing amount begins with a minus, so guarding on the leading
 * character alone turns the entire Amount column into text — and a column of
 * text sums to zero without saying so, which is a worse failure than the one
 * the guard exists to prevent. "-2+3" is not this; "-12.87" is.
 */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  const dangerous = /^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text);
  const safe = dangerous ? `'${text}` : text;
  // Doubling the quotes is the escape CSV defines; wrapping every cell rather
  // than only the ones that need it keeps the output uniform and is what
  // every reader expects.
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // \r\n, because that is what RFC 4180 says and what Excel is happiest with;
  // every other reader copes with it.
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

interface Exportable {
  booking_date: string;
  description: string | null;
  counterparty: string | null;
  amount: number;
  currency: string;
  account_id: string;
  category_id: number | null;
  source: string;
}

export const TRANSACTION_HEADERS = ["Date", "Description", "Payee", "Amount", "Currency", "Account", "Category", "Source"];

export function transactionsToCsv(
  transactions: Exportable[],
  accountName: (id: string) => string | undefined,
  categoryName: (id: number | null) => string | null
): string {
  const rows = transactions.map((tx) => [
    tx.booking_date,
    tx.description ?? "",
    tx.counterparty ?? "",
    // The raw signed number, not a formatted one: a spreadsheet has to be
    // able to add these up, and "-€12.87" is text.
    tx.amount.toFixed(2),
    tx.currency,
    accountName(tx.account_id) ?? "",
    categoryName(tx.category_id) ?? "",
    tx.source,
  ]);
  return toCsv(TRANSACTION_HEADERS, rows);
}

/**
 * Hands the file to the browser.
 *
 * A blob and an object URL rather than a server round trip: the rows are
 * already here, and sending them up only to have them sent back would put a
 * copy of somebody's history through a request that did not need to happen.
 */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM is what makes Excel read it as UTF-8. Without it a payee with an
  // accent or a euro sign arrives mangled, which looks like the export being
  // broken rather than the spreadsheet guessing.
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
