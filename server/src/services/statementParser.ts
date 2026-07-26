import Anthropic from "@anthropic-ai/sdk";

/**
 * Turns a bank statement export into this app's standard transaction shape.
 *
 * Every bank lays its CSV out differently: column order varies, dates come as
 * DD/MM/YYYY or MM/DD/YYYY or ISO, amounts arrive either as one signed column
 * or as separate debit/credit columns (sometimes with outflows written
 * positive), and European exports use comma decimals with dot thousands.
 * Guessing wrong doesn't fail loudly — it silently books a payment on the
 * wrong day, or with the wrong sign.
 *
 * So the model is asked for the *mapping* only — which column is what, and
 * which conventions apply — from a short sample. Every row is then parsed in
 * code from that mapping. The model never transcribes a date or an amount, so
 * no figure in the ledger can be a hallucination, the cost is one small call
 * per upload regardless of row count, and the mapping can be shown to the user
 * and audited.
 *
 * Without an API key it falls back to matching column headers by name, which
 * handles the common exports well enough to be useful on its own.
 */

const MODEL = "claude-opus-5";
// Enough rows for the model to tell DD/MM from MM/DD (needs a day > 12) and to
// see whether a debit column is ever populated, without sending the statement.
const SAMPLE_ROWS = 12;

export type DateFormat = "iso" | "dmy" | "mdy";

export interface StatementMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: DateFormat;
  /** Single signed amount column, when the statement uses one. */
  amountColumn: number | null;
  /** Separate debit/credit columns, when it uses those instead. */
  debitColumn: number | null;
  creditColumn: number | null;
  /** True when outflows are written as positive numbers in the debit column. */
  debitIsPositive: boolean;
  descriptionColumn: number | null;
  counterpartyColumn: number | null;
  decimalSeparator: "." | ",";
  /**
   * Flips every amount's sign. Not inferred — it's the user's correction for
   * a statement whose amounts are unsigned, where money-out is implied by
   * convention rather than written. Nothing in the numbers themselves can
   * distinguish that from a genuine run of income, so it can only be a
   * decision made in the confirmation step.
   */
  invertAmounts: boolean;
  /** How the mapping was arrived at — surfaced to the user after an import. */
  source: "ai" | "heuristic";
  /**
   * The bank the statement appears to come from, and its country, read off
   * whatever header or IBAN the file carries. Used to look up a real logo for
   * the account (see bankLogo.ts) — not part of the column mapping, and null
   * whenever the file doesn't say.
   */
  bankName: string | null;
  bankCountry: string | null;
}

export interface ParsedRow {
  date: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
}

// --- delimited-text parsing -------------------------------------------------

function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    // Count on the header line only — a delimiter that also appears inside
    // quoted descriptions would otherwise win on body rows alone.
    const count = (sample.split(/\r?\n/)[0] ?? "").split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// Hand-rolled rather than a CSV dependency: statements are small, and the
// only subtlety that matters here is that a quoted field may contain the
// delimiter, a newline, or an escaped ("") quote.
export function parseDelimited(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);

  return rows;
}

// Real statements open with a title line, an account number, an address block
// — none of which are part of the table. Those rows have fewer columns than
// the table does, and leaving them in makes the first one look like the header
// row, which throws off every column index after it.
//
// They are split off rather than discarded: the table is what the column
// mapping is derived from, but the preamble is exactly where the bank names
// itself, so it's still worth showing the model.
export function splitPreamble(rows: string[][]): { preamble: string[][]; table: string[][] } {
  const table = stripPreamble(rows);
  return { preamble: rows.slice(0, rows.length - table.length), table };
}

function stripPreamble(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);

  let tableWidth = 0;
  let commonest = 0;
  for (const [width, count] of counts) {
    // Ties go to the wider row: a two-column "IBAN,..." line shouldn't win
    // over the actual table on a very short statement.
    if (count > commonest || (count === commonest && width > tableWidth)) {
      tableWidth = width;
      commonest = count;
    }
  }
  if (tableWidth < 2) return rows;

  const firstTableRow = rows.findIndex((row) => row.length >= tableWidth);
  return firstTableRow > 0 ? rows.slice(firstTableRow) : rows;
}

// --- field normalisation ----------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const SPLIT_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

export function normaliseDate(raw: string, format: DateFormat): string | null {
  const value = raw.trim();

  const iso = ISO_DATE.exec(value);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const parts = SPLIT_DATE.exec(value);
  if (!parts) return null;

  const [, a, b, rawYear] = parts;
  // A two-digit year in a bank statement is this century in practice — these
  // are recent transactions, not historical records.
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  // An unambiguous day (>12) overrides the stated format: a statement that
  // says MM/DD but shows 25/12 is really DD/MM, and trusting the label would
  // silently drop the row as an invalid month.
  const first = Number(a);
  const second = Number(b);
  const dayFirst = format === "dmy" ? second <= 12 || first > 12 : first > 12;

  const day = dayFirst ? a : b;
  const month = dayFirst ? b : a;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}

export function normaliseAmount(raw: string, decimalSeparator: "." | ","): number | null {
  let value = raw.trim();
  if (!value) return null;

  // Accounting notation: (1,234.56) means an outflow.
  let negative = /^\(.*\)$/.test(value);
  if (negative) value = value.slice(1, -1);

  // Trailing DR/CR markers, used by some exports instead of a sign.
  if (/\s*(DR|D)$/i.test(value)) {
    negative = true;
    value = value.replace(/\s*(DR|D)$/i, "");
  }
  value = value.replace(/\s*(CR|C)$/i, "");

  // Remove the furniture a money cell is allowed to carry: currency symbols,
  // a 3-letter ISO code at either end, thousands spaces.
  value = value
    .replace(/^[A-Z]{3}\b/i, "")
    .replace(/\b[A-Z]{3}$/i, "")
    .replace(/[$€£¥R]/gi, "")
    // \u00a0 and \u202f are the non-breaking and narrow no-break spaces some
    // exports use as a thousands separator; \u2019 is the Swiss apostrophe.
    .replace(/[\s\u00a0\u202f\u2019']/g, "");

  // Anything still holding a letter is not an amount — it's a description
  // that happens to contain digits ("TESCO STORES 3288"). Stripping
  // non-numerics first and checking only for a digit would turn that into a
  // valid amount of 3288, which is how a merchant name ends up booked as
  // money, and how the column detector picks a description column as the
  // amount column.
  if (/[a-z]/i.test(value)) return null;
  if (!/\d/.test(value)) return null;
  // Reject anything that isn't digits with optional grouping/decimal marks,
  // so stray punctuation can't parse either.
  if (!/^[\d.,]+$/.test(value.replace(/^[+-]/, ""))) return null;

  if (decimalSeparator === ",") {
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }

  if (value.startsWith("+")) value = value.slice(1);
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

// --- mapping inference ------------------------------------------------------

const MAPPING_SCHEMA = {
  type: "object",
  properties: {
    hasHeader: { type: "boolean" },
    dateColumn: { type: "integer" },
    dateFormat: { type: "string", enum: ["iso", "dmy", "mdy"] },
    amountColumn: { type: ["integer", "null"] },
    debitColumn: { type: ["integer", "null"] },
    creditColumn: { type: ["integer", "null"] },
    debitIsPositive: { type: "boolean" },
    descriptionColumn: { type: ["integer", "null"] },
    counterpartyColumn: { type: ["integer", "null"] },
    decimalSeparator: { type: "string", enum: [".", ","] },
    bankName: { type: ["string", "null"] },
    bankCountry: { type: ["string", "null"] },
  },
  required: [
    "hasHeader",
    "dateColumn",
    "dateFormat",
    "amountColumn",
    "debitColumn",
    "creditColumn",
    "debitIsPositive",
    "descriptionColumn",
    "counterpartyColumn",
    "decimalSeparator",
    "bankName",
    "bankCountry",
  ],
  additionalProperties: false,
} as const;

const HEADER_PATTERNS: { key: keyof StatementMapping; pattern: RegExp }[] = [
  { key: "dateColumn", pattern: /date|posted|booking/i },
  { key: "debitColumn", pattern: /debit|withdraw|paid out|money out/i },
  { key: "creditColumn", pattern: /credit|deposit|paid in|money in/i },
  { key: "amountColumn", pattern: /amount|value/i },
  { key: "counterpartyColumn", pattern: /payee|merchant|counterparty|beneficiary/i },
  { key: "descriptionColumn", pattern: /description|details|narrative|reference|memo|particulars/i },
];

// Used when there's no API key, and as the floor if the model's answer is
// unusable.
//
// English header names are only a hint here, never the mechanism: a German or
// French export ("Datum", "Betrag", "Montant") matches none of them, and a
// name-only approach silently produces a mapping with no amount column, which
// drops every row. So each field falls back to the shape of the data — which
// column parses as dates, which parse as numbers — and that works regardless
// of what language the headers are in.
function heuristicMapping(rows: string[][]): StatementMapping {
  const header = rows[0] ?? [];
  const looksLikeHeader = header.some((cell) => /[a-z]/i.test(cell)) && !normaliseDate(header[0] ?? "", "dmy");

  const hinted: Partial<Record<keyof StatementMapping, number>> = {};
  if (looksLikeHeader) {
    header.forEach((cell, index) => {
      for (const { key, pattern } of HEADER_PATTERNS) {
        if (hinted[key] === undefined && pattern.test(cell)) hinted[key] = index;
      }
    });
  }

  const body = rows.slice(looksLikeHeader ? 1 : 0);
  const columnCount = Math.max(0, ...rows.map((r) => r.length));
  const columnCells = (index: number) => body.map((row) => (row[index] ?? "").trim()).filter((cell) => cell !== "");
  const share = (cells: string[], predicate: (cell: string) => boolean) =>
    cells.length === 0 ? 0 : cells.filter(predicate).length / cells.length;

  // Date column: the leftmost column that mostly parses as a date. Structure
  // beats the header hint — a "Value Date" column can sit beside the booking
  // date, and either works, but a column that doesn't parse never does.
  let dateColumn = hinted.dateColumn ?? -1;
  if (dateColumn < 0 || share(columnCells(dateColumn), (c) => normaliseDate(c, "dmy") !== null) < 0.6) {
    dateColumn = 0;
    for (let i = 0; i < columnCount; i++) {
      if (share(columnCells(i), (c) => normaliseDate(c, "dmy") !== null) >= 0.6) {
        dateColumn = i;
        break;
      }
    }
  }

  // Decimal separator, judged only on non-date columns: "31.10.2026" would
  // otherwise read as a dot decimal and force every European amount to parse
  // with the wrong separator.
  const moneyText = body
    .flatMap((row) => row.filter((_, i) => i !== dateColumn))
    .join(" ");
  const decimalSeparator: "." | "," =
    /\d,\d{2}(\D|$)/.test(moneyText) && !/\d\.\d{2}(\D|$)/.test(moneyText) ? "," : ".";

  const isNumeric = (cell: string) => normaliseAmount(cell, decimalSeparator) !== null;
  const numericColumns: number[] = [];
  for (let i = 0; i < columnCount; i++) {
    if (i === dateColumn) continue;
    const cells = columnCells(i);
    if (cells.length > 0 && share(cells, isNumeric) >= 0.6) numericColumns.push(i);
  }

  let amountColumn: number | null = null;
  let debitColumn: number | null = null;
  let creditColumn: number | null = null;

  if (hinted.debitColumn !== undefined || hinted.creditColumn !== undefined) {
    debitColumn = hinted.debitColumn ?? null;
    creditColumn = hinted.creditColumn ?? null;
  } else if (hinted.amountColumn !== undefined) {
    amountColumn = hinted.amountColumn;
  } else if (numericColumns.length === 1) {
    amountColumn = numericColumns[0];
  } else if (numericColumns.length > 1) {
    // A column containing negatives is a single signed amount column; two
    // columns that are never populated on the same row are money-out and
    // money-in. Anything else falls back to the first numeric column, which
    // the user can correct in the confirmation step.
    const signed = numericColumns.find((i) => columnCells(i).some((c) => (normaliseAmount(c, decimalSeparator) ?? 0) < 0));
    if (signed !== undefined) {
      amountColumn = signed;
    } else {
      const [first, second] = numericColumns;
      const mutuallyExclusive = body.every((row) => {
        const a = (row[first] ?? "").trim();
        const b = (row[second] ?? "").trim();
        return a === "" || b === "";
      });
      if (mutuallyExclusive) {
        debitColumn = first;
        creditColumn = second;
      } else {
        amountColumn = first;
      }
    }
  }

  // Description: the widest free-text column that isn't the date or a number.
  let descriptionColumn = hinted.descriptionColumn ?? null;
  if (descriptionColumn == null) {
    let widest = -1;
    for (let i = 0; i < columnCount; i++) {
      if (i === dateColumn || numericColumns.includes(i)) continue;
      const cells = columnCells(i);
      const averageLength = cells.length === 0 ? 0 : cells.reduce((sum, c) => sum + c.length, 0) / cells.length;
      if (averageLength > widest) {
        widest = averageLength;
        descriptionColumn = i;
      }
    }
  }

  return {
    hasHeader: looksLikeHeader,
    dateColumn,
    // Day-first is the safe default: most non-US exports are DD/MM, and
    // normaliseDate overrides it whenever a day above 12 makes the real order
    // unambiguous either way.
    dateFormat: "dmy",
    amountColumn,
    debitColumn,
    creditColumn,
    debitIsPositive: true,
    descriptionColumn,
    counterpartyColumn: hinted.counterpartyColumn ?? null,
    decimalSeparator,
    invertAmounts: false,
    source: "heuristic",
    // Identifying the bank means reading prose around the table, which is the
    // model's job — the heuristic path deliberately doesn't guess.
    bankName: null,
    bankCountry: null,
  };
}

export async function inferMapping(rows: string[][], preamble: string[][] = []): Promise<StatementMapping> {
  const fallback = heuristicMapping(rows);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const sample = rows
    .slice(0, SAMPLE_ROWS)
    .map((row, i) => `${i}: ${row.map((cell, c) => `[${c}] ${cell}`).join("  |  ")}`)
    .join("\n");

  // The lines above the table are where a statement names its bank and shows
  // an IBAN — the only place bankName can come from. They're shown separately
  // so they can't be mistaken for table rows and skew the column indices.
  const header = preamble
    .slice(0, SAMPLE_ROWS)
    .map((row) => row.join(" "))
    .filter((line) => line.trim() !== "")
    .join("\n");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: MAPPING_SCHEMA } },
      system:
        "You identify the layout of bank statement exports. You are shown the first rows of one, with each cell prefixed by its column index. Report which column holds what and which conventions the file uses. Report the layout only — never transcribe values.",
      messages: [
        {
          role: "user",
          content: [
            "Identify this statement's layout.",
            "",
            ...(header ? ["Lines above the table (not part of it):", header, ""] : []),
            "Table rows:",
            sample,
            "",
            "Set amountColumn when there is a single signed amount column, or debitColumn/creditColumn when outflows and inflows are in separate columns — not both.",
            "debitIsPositive is true when the debit column holds positive numbers for money leaving the account.",
            "dateFormat: iso for YYYY-MM-DD, dmy for day-first, mdy for month-first. If a day above 12 appears, use it to decide.",
            "decimalSeparator is the character before the last two digits of an amount.",
            "bankName: the bank this statement is from, if the file names it or an IBAN/sort code makes it unambiguous — otherwise null. Do not guess from a merchant name in the transaction rows.",
            "bankCountry: that bank's ISO 3166-1 alpha-2 country code (an IBAN's first two letters give it), otherwise null.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return fallback;

    // invertAmounts is a user decision, not something the model reports, so
    // it isn't in the response schema and always starts off.
    const parsed = JSON.parse(text.text) as Omit<StatementMapping, "source" | "invertAmounts">;
    // A mapping with no usable amount column is worse than the heuristic —
    // every row would be dropped.
    if (parsed.amountColumn == null && parsed.debitColumn == null && parsed.creditColumn == null) return fallback;

    return { ...parsed, invertAmounts: false, source: "ai" };
  } catch (err) {
    console.error("Statement mapping inference failed, falling back to header matching:", err);
    return fallback;
  }
}

// --- applying the mapping ---------------------------------------------------

function cell(row: string[], index: number | null): string {
  return index == null ? "" : row[index] ?? "";
}

export function applyMapping(rows: string[][], mapping: StatementMapping): ParsedRow[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const parsed: ParsedRow[] = [];

  for (const row of body) {
    const date = normaliseDate(cell(row, mapping.dateColumn), mapping.dateFormat);
    if (!date) continue;

    let amount: number | null = null;
    if (mapping.amountColumn != null) {
      amount = normaliseAmount(cell(row, mapping.amountColumn), mapping.decimalSeparator);
    } else {
      const debit = normaliseAmount(cell(row, mapping.debitColumn), mapping.decimalSeparator);
      const credit = normaliseAmount(cell(row, mapping.creditColumn), mapping.decimalSeparator);
      // Standard shape throughout this app: negative is money out.
      if (debit != null && debit !== 0) amount = mapping.debitIsPositive ? -Math.abs(debit) : debit;
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
    }

    // A row whose date parses but whose amount doesn't is a subtotal or
    // balance-carried-forward line, not a transaction.
    if (amount == null || !Number.isFinite(amount)) continue;

    const description = cell(row, mapping.descriptionColumn).trim() || null;
    const counterparty = cell(row, mapping.counterpartyColumn).trim() || null;

    parsed.push({ date, amount: mapping.invertAmounts ? -amount : amount, description, counterparty });
  }

  return parsed;
}

export async function parseStatement(text: string): Promise<{ mapping: StatementMapping; rows: ParsedRow[] }> {
  const { preamble, table } = splitPreamble(parseDelimited(text));
  if (table.length === 0) return { mapping: heuristicMapping(table), rows: [] };
  const mapping = await inferMapping(table, preamble);
  return { mapping, rows: applyMapping(table, mapping) };
}
