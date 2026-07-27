import Anthropic from "@anthropic-ai/sdk";

/**
 * Reads the terms of a loan out of its contract.
 *
 * This is the one place in the app where a model reads figures rather than
 * only labels. A statement is a grid, so the parser can find the amount column
 * and the code does the reading; a contract is prose, and "repayable over 60
 * monthly instalments of R4,312.88 commencing 1 March 2026" has no column to
 * find. So the extraction is the model's, and the safeguards move to what
 * happens with its answer:
 *
 *  1. Every field must come with the sentence it was read from. The model
 *     cannot report a figure it can't point at in the document.
 *  2. Each value is re-derived from that quote by code where the quote
 *     contains it, so a number that drifted between reading and reporting is
 *     caught rather than trusted.
 *  3. Values are range-checked — a 400% interest rate or a term ending before
 *     it starts is rejected outright.
 *  4. Nothing is written until the user has seen each figure beside the
 *     sentence it came from and accepted it.
 */

const MODEL = "claude-opus-5";

// The whole document is read. Terms that cost real money — early settlement
// penalties, default interest, credit-life premiums — live in the clauses
// after the summary box, which is exactly the part a "first pages only" read
// would have skipped.
//
// A contract longer than this goes through in overlapping chunks rather than
// being cut short. The overlap keeps a clause that straddles a boundary intact
// in at least one chunk.
const CHARS_PER_PASS = 300_000;
const CHUNK_OVERLAP = 5_000;

export interface ExtractedField<T> {
  value: T;
  /** The sentence from the contract this was read from. */
  quote: string;
}

/**
 * Anything in the agreement worth knowing that isn't one of the six headline
 * figures — fees, penalties, insurance, what counts as default.
 *
 * Deliberately open-ended: the point is to surface what a particular contract
 * says rather than to fill in a form the app decided on in advance.
 */
export interface KeyTerm {
  label: string;
  detail: string;
  quote: string;
}

export interface LoanTerms {
  principal: ExtractedField<number> | null;
  monthlyPayment: ExtractedField<number> | null;
  interestRate: ExtractedField<number> | null;
  startDate: ExtractedField<string> | null;
  endDate: ExtractedField<string> | null;
  termMonths: ExtractedField<number> | null;
  lender: string | null;
  currency: string | null;
  keyTerms: KeyTerm[];
  /** Set when the document was long enough to be read in more than one pass. */
  passes: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    principal: field("number", "The amount borrowed, as a plain number"),
    monthly_payment: field("number", "The regular instalment, as a plain number"),
    interest_rate: field("number", "The annual interest rate as a percentage, e.g. 11.5 for 11.5%"),
    start_date: field("string", "First payment or agreement start date, as YYYY-MM-DD"),
    end_date: field("string", "Final payment date, as YYYY-MM-DD"),
    term_months: field("number", "Total number of instalments"),
    lender: { type: ["string", "null"] },
    currency: { type: ["string", "null"], description: "ISO code, e.g. ZAR, EUR" },
    key_terms: {
      type: "array",
      description: "Everything else in the agreement the borrower should know before signing off on it",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short name for the term, e.g. 'Early settlement'" },
          detail: { type: "string", description: "What it says, in one plain sentence" },
          quote: { type: "string", description: "The exact wording from the document" },
        },
        required: ["label", "detail", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "principal",
    "monthly_payment",
    "interest_rate",
    "start_date",
    "end_date",
    "term_months",
    "lender",
    "currency",
    "key_terms",
  ],
  additionalProperties: false,
} as const;

function field(type: "number" | "string", description: string) {
  return {
    type: ["object", "null"],
    properties: {
      value: { type },
      // Not decoration: this is what makes the answer checkable, both by the
      // code below and by the person confirming it.
      quote: { type: "string", description: "The exact sentence from the contract stating this" },
    },
    required: ["value", "quote"],
    additionalProperties: false,
    description,
  };
}

// Bounds that separate a misread from a real term. A personal loan does not
// run for a century or charge 400%, and a figure outside these is far more
// likely to be a page number or an account number caught by mistake.
const LIMITS = {
  principal: { min: 1, max: 100_000_000 },
  monthlyPayment: { min: 1, max: 10_000_000 },
  interestRate: { min: 0, max: 100 },
  termMonths: { min: 1, max: 600 },
};

/**
 * Flattens text for comparison, so a quote can be checked against the document
 * despite the mangling PDF extraction does to it.
 *
 * Line breaks land mid-sentence, spacing between columns is arbitrary, and
 * typographic quotes and dashes differ between the extracted text and how a
 * quote comes back. None of that changes what the sentence says, so none of it
 * should decide whether a quote is genuine.
 */
export function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a quote actually appears in the document.
 *
 * This is the check that makes the rest meaningful. Verifying a figure against
 * its quote only proves the answer is internally consistent — a fabricated
 * sentence containing a fabricated number passes that easily. Checking the
 * quote against the source is what closes it, and it is only possible because
 * the whole document is read rather than the first pages.
 */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const needle = flatten(quote);
  // Too short to be distinctive: "R500" appears in any contract mentioning
  // R500 and proves nothing about the sentence around it.
  if (needle.length < 12) return false;
  return flatten(source).includes(needle);
}

/**
 * Re-reads a number out of the quote it was supposedly taken from.
 *
 * When the quote contains the figure, the quote's version wins — it is the
 * document's own text. When it doesn't, the value is dropped rather than
 * accepted, because a figure with no support in the sentence behind it is
 * exactly the kind of answer this design exists to catch.
 */
export function verifyNumber(entry: { value: unknown; quote: unknown } | null, bounds: { min: number; max: number }): ExtractedField<number> | null {
  if (!entry || typeof entry.quote !== "string") return null;
  const claimed = typeof entry.value === "number" ? entry.value : Number(entry.value);
  if (!Number.isFinite(claimed)) return null;

  // Every number in the sentence, with thousands separators removed. Both
  // conventions appear in contracts (1,234.56 and 1.234,56), so try each.
  const candidates = new Set<number>();
  for (const raw of entry.quote.match(/\d[\d.,\s]*\d|\d/g) ?? []) {
    const cleaned = raw.replace(/\s/g, "");
    const dotDecimal = Number(cleaned.replace(/,/g, ""));
    const commaDecimal = Number(cleaned.replace(/\./g, "").replace(/,/g, "."));
    if (Number.isFinite(dotDecimal)) candidates.add(dotDecimal);
    if (Number.isFinite(commaDecimal)) candidates.add(commaDecimal);
  }

  // Tolerance covers rounding in how the figure was reported, not a different
  // number: 4312.88 against 4312.88, never 4312 against 4500.
  const supported = [...candidates].some((c) => Math.abs(c - claimed) < 0.005);
  if (!supported) return null;
  if (claimed < bounds.min || claimed > bounds.max) return null;

  return { value: claimed, quote: entry.quote };
}

export function verifyDate(entry: { value: unknown; quote: unknown } | null): ExtractedField<string> | null {
  if (!entry || typeof entry.quote !== "string" || typeof entry.value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.value)) return null;
  const parsed = new Date(`${entry.value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Date doesn't reject an impossible day, it rolls it over — 2026-02-31
  // silently becomes 2026-03-03. Round-tripping is what catches that, and a
  // date that moved is a misread rather than a date.
  if (parsed.toISOString().slice(0, 10) !== entry.value) return null;
  // A loan agreement from the 1800s or the 2200s is a misread year.
  const year = parsed.getUTCFullYear();
  if (year < 1970 || year > 2200) return null;
  return { value: entry.value, quote: entry.quote };
}

/** Splits a long document into overlapping passes, so no clause is cut in half. */
export function chunk(text: string, size = CHARS_PER_PASS, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}

const SYSTEM_PROMPT = [
  "You read consumer loan agreements and report their terms.",
  "Quote the exact wording each item comes from, copied character for character from the document — the quotes are checked against the source text, and an item whose quote cannot be found there is discarded.",
  "A term you cannot point at in the document must be reported as null rather than inferred, calculated, or filled in from what is typical.",
].join(" ");

function buildPrompt(part: string, index: number, total: number): string {
  return [
    total > 1
      ? `Extract the terms of this loan agreement. This is section ${index + 1} of ${total} — report only what appears in this section and null for the rest.`
      : "Extract the terms of this loan agreement.",
    "",
    "Report null for anything the document does not state. Do not calculate a missing field from the others — an end date the contract does not give is null, not start plus term.",
    "",
    "For key_terms, list everything else the borrower should know before signing off on it: fees, early settlement or prepayment penalties, default interest, insurance or credit-life premiums, what happens on a missed payment, variable-rate conditions, security or collateral. Include the ones that cost money even when they read as boilerplate. Leave it empty if the section states none.",
    "",
    "---",
    part,
  ].join("\n");
}

async function readPass(client: Anthropic, part: string, index: number, total: number) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(part, index, total) }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  return JSON.parse(block.text);
}

export async function extractLoanTerms(text: string): Promise<LoanTerms | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const parts = chunk(text);
  // Sequential rather than parallel: a contract is one or two passes in
  // practice, and this runs while someone waits on a modal.
  const results: Record<string, any>[] = [];
  for (const [index, part] of parts.entries()) {
    const parsed = await readPass(client, part, index, parts.length);
    if (parsed) results.push(parsed);
  }
  if (results.length === 0) return null;

  // Every quote is checked against the document it supposedly came from, so a
  // fabricated sentence is dropped however plausible it reads.
  const grounded = <T>(entry: { quote?: unknown } | null, verify: () => T | null): T | null => {
    if (!entry || typeof entry.quote !== "string" || !quoteAppearsIn(entry.quote, text)) return null;
    return verify();
  };

  // First section to state a term wins: the headline figures appear in the
  // summary box at the front, and a later mention is usually a worked example.
  const first = <T>(pick: (parsed: any) => T | null): T | null => {
    for (const parsed of results) {
      const value = pick(parsed);
      if (value) return value;
    }
    return null;
  };

  const terms: LoanTerms = {
    principal: first((p) => grounded(p.principal, () => verifyNumber(p.principal, LIMITS.principal))),
    monthlyPayment: first((p) => grounded(p.monthly_payment, () => verifyNumber(p.monthly_payment, LIMITS.monthlyPayment))),
    interestRate: first((p) => grounded(p.interest_rate, () => verifyNumber(p.interest_rate, LIMITS.interestRate))),
    startDate: first((p) => grounded(p.start_date, () => verifyDate(p.start_date))),
    endDate: first((p) => grounded(p.end_date, () => verifyDate(p.end_date))),
    termMonths: first((p) => grounded(p.term_months, () => verifyNumber(p.term_months, LIMITS.termMonths))),
    lender: first((p) => (typeof p.lender === "string" && p.lender ? p.lender : null)),
    currency: first((p) => (typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : null)),
    keyTerms: collectKeyTerms(results, text),
    passes: parts.length,
  };

  // A term that ends before it starts means one of the two dates was read off
  // the wrong line. Neither can be trusted, so both go.
  if (terms.startDate && terms.endDate && terms.endDate.value <= terms.startDate.value) {
    terms.startDate = null;
    terms.endDate = null;
  }

  return terms;
}

// Chunks overlap, so a clause near a boundary is read twice and comes back
// twice. Deduplicating on the quote keeps one copy of each.
export function collectKeyTerms(results: { key_terms?: unknown }[], source: string): KeyTerm[] {
  const seen = new Set<string>();
  const terms: KeyTerm[] = [];

  for (const parsed of results) {
    if (!Array.isArray(parsed.key_terms)) continue;
    for (const item of parsed.key_terms) {
      if (!item || typeof item.label !== "string" || typeof item.detail !== "string" || typeof item.quote !== "string") continue;
      if (!quoteAppearsIn(item.quote, source)) continue;

      const key = flatten(item.quote);
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({ label: item.label, detail: item.detail, quote: item.quote });
    }
  }

  return terms;
}
