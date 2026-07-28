import { extractText, getDocumentProxy } from "unpdf";

/**
 * pdf.js (inside unpdf) calls Math.sumPrecise, which Node does not have yet —
 * it is a very recent addition to the language and is absent from Node 24.
 *
 * Only some documents reach the code path that uses it, which is why most
 * statements imported fine and one particular Barclays PDF failed with
 * "Math.sumPrecise is not a function". That surfaced as "this PDF's text
 * could not be read", pointing at the file when the fault was ours.
 *
 * Neumaier summation rather than a plain reduce: the function exists to be
 * exact, and pdf.js uses it on glyph positions where accumulated error moves
 * text between columns.
 */
if (typeof (Math as { sumPrecise?: unknown }).sumPrecise !== "function") {
  (Math as unknown as { sumPrecise: (values: Iterable<number>) => number }).sumPrecise = (values) => {
    let sum = 0;
    let compensation = 0;
    for (const value of values) {
      const next = sum + value;
      // Whichever operand is larger keeps its low-order bits; the other's are
      // what gets lost, so that is what the compensation has to recover.
      compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    }
    return sum + compensation;
  };
}

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

/**
 * The document's text, unstructured.
 *
 * A statement is a grid and gets turned into one; a contract is prose, where
 * the same reshaping would destroy the sentences the terms live in.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const document = await getDocumentProxy(bytes);
  const { text } = await extractText(document, { mergePages: true });
  return text;
}

/** A run of text with where it sits on the page. */
interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

// Two text runs within this many units of each other vertically belong to the
// same line. Generous enough for the sub-point drift between cells of one row,
// tight enough not to merge adjacent rows of a dense statement.
const LINE_TOLERANCE = 2.5;

// A gap this wide between runs is a column boundary rather than a space. A
// space in a 9pt font is roughly 2 units; column padding is far wider.
const COLUMN_GAP = 5;

/**
 * Rebuilds the page's rows from where its text actually sits.
 *
 * A PDF has no lines and no columns, only runs of text at coordinates. The
 * newlines a text extractor inserts are its own guess, and on some documents
 * that guess is badly wrong: one Barclays statement came back as fragments in
 * the wrong order — "Null Malcolm Barske", "r £4.24", "rske" — with six dated
 * lines in a whole statement, because the text is drawn in pieces that the
 * extractor stitched by document order rather than by position.
 *
 * Grouping by vertical position recovers the real lines, and the horizontal
 * gaps between runs give the columns. This works on the documents the
 * whitespace heuristic handled too, so it is the primary path rather than a
 * special case.
 */
async function extractPositionedRows(document: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<string[][]> {
  const pages: { y: number; items: PositionedItem[] }[][] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    const items: PositionedItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
      const transform = (item as { transform?: number[] }).transform;
      if (!transform || transform.length < 6) continue;
      items.push({ str: item.str, x: transform[4], y: transform[5], width: (item as { width?: number }).width ?? 0 });
    }
    if (items.length === 0) continue;

    // Group into lines by y, then order the page top to bottom. PDF y grows
    // upwards, so the largest y is the top of the page.
    const lines: { y: number; items: PositionedItem[] }[] = [];
    for (const item of items.sort((a, b) => b.y - a.y)) {
      const line = lines.find((l) => Math.abs(l.y - item.y) <= LINE_TOLERANCE);
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    pages.push(lines);
  }

  // Columns are worked out across the whole document, not per page. A
  // statement keeps one layout throughout, and deriving the columns separately
  // for each page gave them different indices per page — the amount column
  // being the third on one page and the fourth on the next, which reads
  // downstream as amounts scattered across columns and no usable mapping.
  const anchors = columnAnchors(pages.flat());

  const rows: string[][] = [];
  for (const lines of pages) {
    for (const line of lines) {
      const cells: string[] = new Array(anchors.length).fill("");
      for (const item of line.items.sort((a, b) => a.x - b.x)) {
        const column = columnFor(item, anchors);
        // A single space between runs inside a cell: the extractor drops the
        // spacing, so "TESCO" and "STORES" would otherwise fuse.
        cells[column] += (cells[column] && !cells[column].endsWith(" ") ? " " : "") + item.str;
      }
      const trimmed = cells.map((cell) => cell.trim());
      if (trimmed.some((cell) => cell !== "")) rows.push(trimmed);
    }
  }

  return pad(rows);
}

// A column has to be used by at least this many lines to be a column rather
// than something in the letterhead that happened to line up.
const MIN_LINES_PER_COLUMN = 3;

const MONEY = /^[-+(]?[£$€]?[\d,]+\.\d{2}\)?$/;

/**
 * The edge a run of text is lined up on.
 *
 * Money columns are right-aligned, so the left edge of an amount moves with
 * the number's width — "1,159.83" starts further left than "2.99" in the same
 * column. Clustering left edges therefore breaks one column into several and
 * scatters amounts across them. Text is left-aligned and has the opposite
 * property, so each kind is clustered on the edge that actually holds still.
 */
function anchorOf(item: PositionedItem): number {
  return MONEY.test(item.str.trim()) ? item.x + item.width : item.x;
}

function columnAnchors(lines: { items: PositionedItem[] }[]): number[] {
  const clusters: { anchor: number; count: number }[] = [];

  for (const line of lines) {
    for (const item of line.items) {
      const anchor = anchorOf(item);
      const cluster = clusters.find((c) => Math.abs(c.anchor - anchor) <= COLUMN_GAP);
      if (cluster) cluster.count++;
      else clusters.push({ anchor, count: 1 });
    }
  }

  const kept = clusters.filter((c) => c.count >= MIN_LINES_PER_COLUMN).map((c) => c.anchor);
  // Nothing recurred often enough to be a column — a single-column document.
  return kept.length > 0 ? kept.sort((a, b) => a - b) : [0];
}

/** The column an item belongs to: the one whose anchor its own is nearest. */
function columnFor(item: PositionedItem, anchors: number[]): number {
  const anchor = anchorOf(item);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const distance = Math.abs(anchors[i] - anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Whether a grid actually separated its columns.
 *
 * A statement that parsed properly has amounts somewhere other than the first
 * column. When every line has collapsed into one cell — "Start balance
 * £2,555.05" — the grid is nominally several columns wide and carries no
 * structure at all, which downstream reads as a table with no amount column.
 */
export function looksTabular(rows: string[][]): boolean {
  const withAmountsBeyondFirst = rows.filter((row) => row.slice(1).some((cell) => MONEY.test(cell.trim())));
  return withAmountsBeyondFirst.length >= 5;
}

export async function extractPdfRows(bytes: Uint8Array): Promise<string[][]> {
  const document = await getDocumentProxy(bytes);

  // The whitespace path first, because it is the one verified against a real
  // statement's own control totals. Position-based reconstruction is the
  // rescue for documents it can't read rather than a replacement for it — no
  // reason to change how a statement that already imports correctly is read.
  const { text } = await extractText(document, { mergePages: true });
  const fromWhitespace = textToRows(text);
  if (looksTabular(fromWhitespace)) {
    console.log("[pdf extract]", JSON.stringify({ via: "whitespace", rows: fromWhitespace.length, columns: fromWhitespace[0]?.length ?? 0 }));
    return fromWhitespace;
  }

  const positioned = await extractPositionedRows(document);
  // Extraction is the step most likely to behave differently on a serverless
  // runtime than locally, and an empty or differently-shaped result is
  // indistinguishable from a parsing failure downstream.
  console.log("[pdf extract]", JSON.stringify({ via: "position", rows: positioned.length, columns: positioned[0]?.length ?? 0 }));
  return looksTabular(positioned) ? positioned : fromWhitespace;
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
    return pad(lines.map((line) => line.split(/ {2,}/).map((cell) => cell.trim())).filter((row) => row.some((cell) => cell !== "")));
  }

  return pad(columnsByShape(lines));
}

/**
 * Squares off the grid so every row has the same number of cells.
 *
 * A statement's letterhead lines come back as one cell while its transaction
 * rows come back as four, and that raggedness leaks: the column editor builds
 * its dropdowns from the first row and offers a single column with no amount
 * to choose, and the layout sample shows one column too. Padding every row to
 * the widest makes the grid rectangular, so a column index means the same
 * thing on every row.
 */
function pad(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((row) => (row.length === width ? row : [...row, ...Array(width - row.length).fill("")]));
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
