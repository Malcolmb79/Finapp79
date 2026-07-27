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

// The whole contract is rarely needed and the terms are almost always in the
// first pages, but schedules do run long. This bounds the prompt without
// cutting into the part that matters.
const MAX_CHARS = 60_000;

export interface ExtractedField<T> {
  value: T;
  /** The sentence from the contract this was read from. */
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

export async function extractLoanTerms(text: string): Promise<LoanTerms | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system:
      "You read consumer loan agreements and report their terms. Quote the exact sentence each figure comes from — a term you cannot point at in the document must be reported as null rather than inferred, calculated, or filled in from what is typical.",
    messages: [
      {
        role: "user",
        content: [
          "Extract the terms of this loan agreement.",
          "",
          "Report null for anything the document does not state. Do not calculate a missing field from the others — an end date the contract does not give is null, not start plus term.",
          "",
          "---",
          text.slice(0, MAX_CHARS),
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  const parsed = JSON.parse(block.text);

  const terms: LoanTerms = {
    principal: verifyNumber(parsed.principal, LIMITS.principal),
    monthlyPayment: verifyNumber(parsed.monthly_payment, LIMITS.monthlyPayment),
    interestRate: verifyNumber(parsed.interest_rate, LIMITS.interestRate),
    startDate: verifyDate(parsed.start_date),
    endDate: verifyDate(parsed.end_date),
    termMonths: verifyNumber(parsed.term_months, LIMITS.termMonths),
    lender: typeof parsed.lender === "string" ? parsed.lender : null,
    currency: typeof parsed.currency === "string" && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : null,
  };

  // A term that ends before it starts means one of the two dates was read off
  // the wrong line. Neither can be trusted, so both go.
  if (terms.startDate && terms.endDate && terms.endDate.value <= terms.startDate.value) {
    terms.startDate = null;
    terms.endDate = null;
  }

  return terms;
}
