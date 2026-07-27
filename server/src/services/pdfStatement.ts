import { extractText, getDocumentProxy } from "unpdf";

/**
 * Turns a PDF statement into the same row grid a CSV produces, so everything
 * downstream — column mapping, the confirmation dialog, the importer — works
 * on PDFs without knowing they were ever PDFs.
 *
 * Text is extracted deterministically rather than read by the model: the
 * amounts and dates in a statement must come from the file itself, and that
 * principle doesn't change just because the container is a PDF.
 *
 * The hard part is that a PDF has no columns — only text at positions. What
 * survives extraction is a line per row with runs of whitespace where the
 * column gaps were, so runs of two or more spaces are treated as the
 * delimiter. That reconstructs a grid faithfully for the fixed-width layout
 * every bank statement uses, while leaving single spaces inside a merchant
 * name intact.
 */

// A PDF always begins with this signature. Checked on content rather than the
// filename, since bank exports frequently arrive with no extension at all.
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function extractPdfRows(bytes: Uint8Array): Promise<string[][]> {
  const document = await getDocumentProxy(bytes);
  const { text } = await extractText(document, { mergePages: true });
  return textToRows(text);
}

export function textToRows(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "    ").trimEnd())
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) return [];

  const byPosition = columnsByPosition(lines);
  if (byPosition) return byPosition;

  if (lines.some((line) => / {2,}/.test(line))) {
    // Text that keeps its gaps but isn't consistently aligned: two or more
    // spaces is a boundary, a single space stays inside a value.
    return lines.map((line) => line.split(/ {2,}/).map((cell) => cell.trim())).filter((row) => row.some((cell) => cell !== ""));
  }

  return columnsByShape(lines);
}

// Leading date on a transaction line: "08 Jun", "8 June", "01/07/2026",
// "2026-07-01".
const LEADING_DATE = /^(\d{1,2}[\s-]+[A-Za-z]{3,9}\.?(?:[\s-]+\d{2,4})?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s+/;
// A money token at the end of a line, optionally carrying a Cr/Dr direction
// marker. Deliberately allows no spaces inside the number: with a space
// permitted, "203.17 37,119.71" matches as one token and the amount and the
// running balance are read as a single value.
const TRAILING_AMOUNT = /(-?\d[\d,]*(?:[.,]\d{2})?\s*(?:Cr|Dr)?\.?)$/i;

/**
 * Rebuilds columns from lines that have no whitespace structure left at all.
 *
 * Some PDF extractors join every text item with a single space, so a row
 * arrives as one run of words and numbers. There are no gaps to slice on and
 * no delimiter to split on — but a statement line still has a fixed shape: a
 * date at the front, a running balance at the end, the amount just before it,
 * and the description in between. Reading it by that shape recovers the grid
 * the rest of the pipeline expects, and lines that don't match (headings,
 * addresses, page furniture) are left as single cells that fall out later
 * because they carry no parseable date.
 */
function columnsByShape(lines: string[]): string[][] {
  return lines.map((line) => {
    const dateMatch = LEADING_DATE.exec(line);
    if (!dateMatch) return [line];

    const date = dateMatch[1].trim();
    let rest = line.slice(dateMatch[0].length).trim();

    // Pull the trailing money tokens off the end, right to left.
    const trailing: string[] = [];
    for (let i = 0; i < 2; i++) {
      const match = TRAILING_AMOUNT.exec(rest);
      if (!match) break;
      const token = match[1].trim();
      // A bare year or a card fragment isn't money — require a decimal part,
      // which every amount on a statement has.
      if (!/[.,]\d{2}(?:\s*(?:Cr|Dr)\.?)?$/i.test(token)) break;
      trailing.unshift(token);
      rest = rest.slice(0, match.index).trim();
    }

    if (trailing.length === 0) return [line];
    // Two trailing numbers means amount then running balance; one means the
    // statement prints no balance column.
    const [amount, balance] = trailing.length === 2 ? trailing : [trailing[0], ""];
    return [date, rest, amount, balance];
  });
}

/**
 * Slices fixed-width text by the character positions its columns actually
 * occupy, rather than by runs of whitespace.
 *
 * Splitting on whitespace looks equivalent until a cell is empty. On a row
 * with no debit, the gap where that value would be merges with its
 * neighbours, the row comes back one cell short, and every value after it
 * shifts a column left — so a credit lands in the debit column and an income
 * row is imported as a payment. Nothing about the resulting row looks wrong.
 *
 * Positions don't have that failure: a column that is blank on one row is
 * still blank in the same place, so the empty cell is preserved and the
 * alignment holds.
 */
function columnsByPosition(lines: string[]): string[][] | null {
  // Only the table's own lines should define the boundaries. A title or
  // address line spans the full width and would erase every gap.
  const widths = lines.map((l) => l.length).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)];
  const tableLines = lines.filter((l) => l.length >= medianWidth * 0.5);
  if (tableLines.length < 2) return null;

  const maxLength = Math.max(...tableLines.map((l) => l.length));
  // A position is a separator only if every table line has a space there.
  const isSeparator: boolean[] = [];
  for (let i = 0; i < maxLength; i++) {
    isSeparator[i] = tableLines.every((line) => (line[i] ?? " ") === " ");
  }

  // Column ranges are the stretches between gaps of two or more spaces; a
  // single-space gap is inside a value, not between columns.
  const ranges: [number, number][] = [];
  let start: number | null = null;
  let gapLength = 0;
  for (let i = 0; i < maxLength; i++) {
    if (isSeparator[i]) {
      gapLength++;
      if (start !== null && gapLength >= 2) {
        ranges.push([start, i - gapLength + 1]);
        start = null;
      }
    } else {
      if (start === null) start = i - Math.max(0, gapLength - 1) >= 0 ? i : 0;
      gapLength = 0;
    }
  }
  if (start !== null) ranges.push([start, maxLength]);

  // Fewer than two columns means the positional read found no structure —
  // let the whitespace fallback try instead.
  if (ranges.length < 2) return null;

  return lines
    .map((line) => ranges.map(([from, to]) => line.slice(from, to).trim()))
    .filter((row) => row.some((cell) => cell !== ""));
}
