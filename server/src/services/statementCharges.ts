import type { ParsedRow } from "./statementParser.js";

/**
 * Names the rows a statement charges you for but doesn't describe.
 *
 * An FNB cheque account prints its own fee postings with the description
 * column empty — the PDF's text layer has no run at that position at all, so
 * no column mapping will ever produce a name. What it does print, further up
 * the page, is a summary of what it charged:
 *
 *     Bank Charges
 *     Service Fees        241.62 Dr
 *     Cash Deposit Fees     0.00
 *     Other Fees           69.00 Dr
 *
 * And 2.00 + 114.62 + 125.00 is 241.62 exactly, while the remaining unnamed
 * row is 69.00 exactly. The statement does say what those rows are; it says
 * it in a different place and in aggregate.
 *
 * So the label is read from the document rather than invented, and the
 * arithmetic that justifies it is carried alongside and shown. Same grounded
 * footing as `loanContract.ts` and `policyDocument.ts`: the figure and the
 * wording both come from the file, nothing is written without being shown
 * first, and where the evidence is ambiguous nothing is claimed at all.
 */

/** A total the statement attributes to a named kind of charge. */
export interface ChargeLine {
  label: string;
  /** Always positive: a statement prints a charge as a magnitude plus Dr/Cr. */
  total: number;
  /**
   * The amount exactly as the document writes it.
   *
   * Quoted back rather than reformatted. The evidence shown to the owner is a
   * claim about what this statement says, so it has to be findable on the
   * page — reformatting 241.62 into a locale's "241,62" makes the quote wrong
   * about the one document it is describing.
   */
  printed: string;
}

/** A name for one unnamed row, with the sum that justifies it. */
export interface ChargeName {
  label: string;
  evidence: string;
}

/**
 * Only lines naming a fee or a charge are read.
 *
 * A statement is full of "<words> <number>" lines — opening balance, closing
 * balance, overdraft limit, turnover — and any of them could coincidentally
 * equal some combination of the unnamed rows. Restricting to the charges
 * summary is what keeps a coincidence from being read as an explanation.
 */
const CHARGE_LABEL = /\b(fee|fees|charge|charges)\b/i;

/**
 * A running total is not a charge even when it is labelled as one. "Total
 * bank charges" is the sum of the lines beneath it, so matching against it
 * would claim the same rows twice under a vaguer name.
 */
const AGGREGATE_LABEL = /\b(total|balance|turnover|limit)\b/i;

const AMOUNT_AT_END = /^(.*?)[\s:]+([\d][\d.,]*)\s*(Dr|Cr)?\.?$/i;

/** How many unnamed rows make the subset search worth attempting. */
const MAX_ROWS_TO_SEARCH = 18;

function cents(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

/**
 * The charges a statement names and totals, read off its summary block.
 *
 * Takes the whole grid rather than the transaction table: the summary sits
 * above the transactions, among the lines the mapping discards for having no
 * date, which is exactly why nothing downstream has ever looked at it.
 */
export function chargeLines(rows: string[][], decimalSeparator: "." | "," = "."): ChargeLine[] {
  const found: ChargeLine[] = [];

  for (const row of rows) {
    const line = row
      .map((cell) => cell.trim())
      .filter((cell) => cell !== "")
      .join(" ")
      .trim();
    if (!line) continue;

    const match = AMOUNT_AT_END.exec(line);
    if (!match) continue;

    const label = match[1].trim().replace(/[:\-–]+$/, "").trim();
    if (!CHARGE_LABEL.test(label)) continue;
    if (AGGREGATE_LABEL.test(label)) continue;
    // A label that is itself mostly digits is a transaction line that happens
    // to mention a fee, not a summary of one.
    if (/\d{2}[/-]\d{2}/.test(label) || /^\d/.test(label)) continue;

    const total = parseSummaryAmount(match[2], decimalSeparator);
    // Zero explains nothing: "Cash Deposit Fees 0.00" is the statement saying
    // there weren't any.
    if (total == null || total === 0) continue;

    found.push({ label, total, printed: match[2].trim() });
  }

  return found;
}

function parseSummaryAmount(raw: string, decimalSeparator: "." | ","): number | null {
  const cleaned =
    decimalSeparator === ","
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

/**
 * Every subset of `values` summing to `target`, in cents, stopping once a
 * second one is found.
 *
 * Two different combinations adding to the same total means the statement
 * does not determine which rows the charge refers to. That is a real
 * possibility with small fees — 2.00 + 3.00 and 5.00 both make 5.00 — and the
 * honest answer there is to say nothing rather than to pick one.
 */
function soleSubset(values: number[], target: number): number[] | null {
  if (values.length > MAX_ROWS_TO_SEARCH) return null;

  let solution: number[] | null = null;
  let count = 0;

  const walk = (index: number, running: number, chosen: number[]) => {
    if (count > 1) return;
    if (running === target && chosen.length > 0) {
      count++;
      if (count === 1) solution = [...chosen];
      return;
    }
    if (index >= values.length || running > target) return;
    chosen.push(index);
    walk(index + 1, running + values[index], chosen);
    chosen.pop();
    walk(index + 1, running, chosen);
  };

  walk(0, 0, []);
  return count === 1 ? solution : null;
}

/**
 * A name for each row the statement left unnamed, or null where it has none.
 *
 * Aligned with `rows` by index. A charge is only claimed when exactly one
 * combination of the still-unclaimed rows adds up to it, and a row is only
 * ever claimed once — so two charges that could both explain the same row
 * leave it unexplained rather than fighting over it.
 */
export function nameUnnamedRows(rows: ParsedRow[], charges: ChargeLine[]): (ChargeName | null)[] {
  const names: (ChargeName | null)[] = rows.map(() => null);

  const unnamedIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.description?.trim() && !row.counterparty?.trim())
    .map(({ index }) => index);
  if (unnamedIndexes.length === 0 || charges.length === 0) return names;

  const claimed = new Set<number>();

  for (const charge of charges) {
    const available = unnamedIndexes.filter((index) => !claimed.has(index));
    if (available.length === 0) break;

    const subset = soleSubset(
      available.map((index) => cents(rows[index].amount)),
      cents(charge.total)
    );
    if (!subset) continue;

    const matched = subset.map((position) => available[position]);
    const evidence =
      matched.length === 1
        ? `The statement's summary says ${charge.label} ${charge.printed}, which is this row exactly.`
        : `The statement's summary says ${charge.label} ${charge.printed}, which is this row and ${
            matched.length - 1
          } other${matched.length - 1 === 1 ? "" : "s"} added together.`;

    for (const index of matched) {
      claimed.add(index);
      names[index] = { label: charge.label, evidence };
    }
  }

  return names;
}
