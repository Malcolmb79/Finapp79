import Anthropic from "@anthropic-ai/sdk";
import {
  chunk,
  collectKeyTerms,
  quoteAppearsIn,
  verifyDate,
  verifyNumber,
  type ExtractedField,
  type KeyTerm,
} from "./loanContract.js";

/**
 * Reads a life insurance policy statement or schedule.
 *
 * The same shape as the loan contract reader, and for the same reason: a policy
 * document is prose, not a grid, so "your cover is R2 000 000 with a fund value
 * of R48 213.09 at 30 June 2026" has no amount column for code to find. The
 * extraction is therefore the model's, and every safeguard from
 * `loanContract.ts` applies unchanged — each field carries the sentence it was
 * read from, the value is re-derived from that sentence by code, the sentence
 * is checked against the document, figures are range-checked, and nothing is
 * written until a person has confirmed it. Those helpers are imported rather
 * than reimplemented.
 *
 * What is specific to this document is the pair of figures at the centre of it:
 *
 *   The **cover amount** (sum assured) pays out on death. It is not money held.
 *   The **surrender value** (cash value, fund value, investment value) is what
 *   the policy is worth if cashed in today. That one is an asset.
 *
 * They sit side by side on the same page, in the same currency, often within a
 * sentence of each other, and a term policy quotes a large cover with no
 * surrender value at all. Reporting the cover as a surrender value would put
 * the whole sum assured into net worth — so this reader's extra work, over and
 * above the loan reader's, is keeping the two apart:
 *
 *  - The prompt names the distinction and forbids substituting one for the
 *    other when the document states only cover.
 *  - `dropConfusedSurrender` below drops a surrender value whose quote is the
 *    sentence the cover amount came from, or whose figure equals the cover.
 *    One sentence stating one figure cannot be evidence for both.
 */

const MODEL = "claude-opus-5";

export interface PolicyFacts {
  insurer: string | null;
  policyNumber: string | null;
  currency: string | null;
  /** Sum assured — what pays out on death. Protection, never wealth. */
  coverAmount: ExtractedField<number> | null;
  /** Cash/fund/surrender value — what it is worth if cashed in today. */
  surrenderValue: ExtractedField<number> | null;
  premium: ExtractedField<number> | null;
  premiumFrequency: "monthly" | "quarterly" | "annual" | null;
  startDate: ExtractedField<string> | null;
  maturityDate: ExtractedField<string> | null;
  /** The date the figures above were true on — a statement's "as at". */
  valuedAt: ExtractedField<string> | null;
  keyTerms: KeyTerm[];
  /** Set when the document was long enough to be read in more than one pass. */
  passes: number;
}

function field(type: "number" | "string", description: string) {
  return {
    type: ["object", "null"],
    properties: {
      value: { type },
      quote: { type: "string", description: "The exact sentence from the document stating this" },
    },
    required: ["value", "quote"],
    additionalProperties: false,
    description,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    insurer: { type: ["string", "null"], description: "The insurance company's name" },
    policy_number: { type: ["string", "null"] },
    currency: { type: ["string", "null"], description: "ISO code, e.g. ZAR, GBP, EUR" },
    cover_amount: field(
      "number",
      "The sum assured / cover amount / benefit payable on death, as a plain number. NOT any cash or fund value."
    ),
    surrender_value: field(
      "number",
      "The surrender value / cash value / fund value / investment value — what the policy is worth if cashed in today, as a plain number. Null for a pure risk or term policy, which has none."
    ),
    premium: field("number", "The recurring premium, as a plain number"),
    // Enum with no sibling `type`. Declaring both is rejected outright —
    // "Enum value 'monthly' does not match declared type '['string','null']'"
    // — because the enum's values are checked against the union rather than
    // against each member of it. The enum alone already constrains the value,
    // and null is one of the permitted ones.
    premium_frequency: { enum: ["monthly", "quarterly", "annual", null] },
    start_date: field("string", "Date the policy commenced, as YYYY-MM-DD"),
    maturity_date: field("string", "Date the policy matures or expires, as YYYY-MM-DD"),
    valued_at: field("string", "The 'as at' date the values on this statement were calculated, as YYYY-MM-DD"),
    key_terms: {
      type: "array",
      description: "Everything else the policyholder should know: exclusions, waiting periods, premium escalation, cessions, loans against the policy",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short name for the term, e.g. 'Suicide exclusion'" },
          detail: { type: "string", description: "What it says, in one plain sentence" },
          quote: { type: "string", description: "The exact wording from the document" },
        },
        required: ["label", "detail", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "insurer",
    "policy_number",
    "currency",
    "cover_amount",
    "surrender_value",
    "premium",
    "premium_frequency",
    "start_date",
    "maturity_date",
    "valued_at",
    "key_terms",
  ],
  additionalProperties: false,
} as const;

// Bounds that separate a misread from a real figure. A cover amount runs to
// millions; a premium does not. A figure outside these is far more likely to be
// a policy number or a page reference caught by mistake.
//
// Surrender starts at 0 rather than 1 because zero is a real and common answer:
// a policy that has not yet built a value says so explicitly.
const LIMITS = {
  cover: { min: 1, max: 1_000_000_000 },
  surrender: { min: 0, max: 1_000_000_000 },
  premium: { min: 1, max: 1_000_000 },
};

const FREQUENCIES = new Set(["monthly", "quarterly", "annual"]);

/**
 * Drops a surrender value that is really the cover amount wearing its name.
 *
 * This is the failure this reader exists to prevent, and it survives every
 * other check: the figure is real, the sentence is real, the sentence contains
 * the figure, and the whole thing is in range. What gives it away is that the
 * evidence is the *same evidence* the cover amount rests on — one sentence
 * stating one number cannot establish two different figures — or that the two
 * values are simply identical, which no real statement reports.
 *
 * Dropped rather than flagged: a policy with no surrender value recorded is
 * correct and useful, whereas one carrying its cover amount under a heading
 * that says "what it is worth today" is a number waiting to be believed.
 */
export function dropConfusedSurrender(
  cover: ExtractedField<number> | null,
  surrender: ExtractedField<number> | null
): ExtractedField<number> | null {
  if (!cover || !surrender) return surrender;
  if (surrender.value === cover.value) return null;
  if (surrender.quote.trim() === cover.quote.trim()) return null;
  return surrender;
}

const SYSTEM_PROMPT = [
  "You read life insurance policy statements and schedules, and report what they state.",
  "Quote the exact wording each item comes from, copied character for character from the document — the quotes are checked against the source text, and an item whose quote cannot be found there is discarded.",
  "A figure you cannot point at in the document must be reported as null rather than inferred, calculated, or filled in from what is typical.",
  "The cover amount and the surrender value are different things and must never be confused: the cover amount (sum assured) is paid out on death, while the surrender value (also called cash value, fund value or investment value) is what the policy is worth if cashed in today.",
  "A term or pure risk policy has a cover amount and no surrender value. Where the document states no cash, fund or surrender value, report surrender_value as null — never repeat the cover amount there.",
].join(" ");

function buildPrompt(part: string, index: number, total: number): string {
  return [
    total > 1
      ? `Extract the details of this life insurance policy. This is section ${index + 1} of ${total} — report only what appears in this section and null for the rest.`
      : "Extract the details of this life insurance policy.",
    "",
    "Report null for anything the document does not state. Do not calculate a missing field from the others.",
    "",
    "cover_amount is the benefit paid on death. surrender_value is what the policy is worth if cashed in today — look for 'surrender value', 'cash value', 'fund value', 'investment value' or 'policy value'. If the document gives no such figure, surrender_value is null.",
    "",
    "For key_terms, list what the policyholder should know beyond the headline figures: exclusions, waiting periods, premium escalation or review terms, cessions, loans taken against the policy, what happens if a premium is missed, beneficiaries. Leave it empty if the section states none.",
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

/** One pass's JSON, before any of it has been checked against the document. */
type RawPass = Record<string, unknown>;

/**
 * A `{ value, quote }` entry from a pass, still unverified.
 *
 * Everything stays `unknown` on purpose: this only narrows the shape enough for
 * `verifyNumber`/`verifyDate` to be handed it, and those are what decide
 * whether the contents are real.
 */
function rawField(value: unknown): { value: unknown; quote: unknown } | null {
  return value !== null && typeof value === "object" ? (value as { value: unknown; quote: unknown }) : null;
}

export async function extractPolicyFacts(text: string): Promise<PolicyFacts | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const parts = chunk(text);
  // Sequential, like the contract reader: a policy schedule is one pass in
  // practice, and this runs while someone waits on a modal.
  const results: RawPass[] = [];
  for (const [index, part] of parts.entries()) {
    const parsed = await readPass(client, part, index, parts.length);
    if (parsed) results.push(parsed);
  }
  if (results.length === 0) return null;

  const grounded = <T>(entry: { quote?: unknown } | null, verify: () => T | null): T | null => {
    if (!entry || typeof entry.quote !== "string" || !quoteAppearsIn(entry.quote, text)) return null;
    return verify();
  };

  const first = <T>(pick: (parsed: RawPass) => T | null): T | null => {
    for (const parsed of results) {
      const value = pick(parsed);
      if (value) return value;
    }
    return null;
  };

  /** A `{ value, quote }` number field, grounded in the document and in range. */
  const readNumber = (raw: unknown, bounds: { min: number; max: number }) => {
    const entry = rawField(raw);
    return grounded(entry, () => verifyNumber(entry, bounds));
  };

  const readDate = (raw: unknown) => {
    const entry = rawField(raw);
    return grounded(entry, () => verifyDate(entry));
  };

  const coverAmount = first((p) => readNumber(p.cover_amount, LIMITS.cover));
  const surrenderValue = first((p) => readNumber(p.surrender_value, LIMITS.surrender));

  const facts: PolicyFacts = {
    insurer: first((p) => (typeof p.insurer === "string" && p.insurer ? p.insurer : null)),
    policyNumber: first((p) => (typeof p.policy_number === "string" && p.policy_number ? p.policy_number : null)),
    currency: first((p) => (typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : null)),
    coverAmount,
    surrenderValue: dropConfusedSurrender(coverAmount, surrenderValue),
    premium: first((p) => readNumber(p.premium, LIMITS.premium)),
    premiumFrequency: first((p) =>
      typeof p.premium_frequency === "string" && FREQUENCIES.has(p.premium_frequency)
        ? (p.premium_frequency as "monthly" | "quarterly" | "annual")
        : null
    ),
    startDate: first((p) => readDate(p.start_date)),
    maturityDate: first((p) => readDate(p.maturity_date)),
    valuedAt: first((p) => readDate(p.valued_at)),
    keyTerms: collectKeyTerms(results, text),
    passes: parts.length,
  };

  // A policy that matures before it starts means one of the two dates was read
  // off the wrong line. Neither can be trusted, so both go — same reasoning as
  // the loan reader's start/end pair.
  if (facts.startDate && facts.maturityDate && facts.maturityDate.value <= facts.startDate.value) {
    facts.startDate = null;
    facts.maturityDate = null;
  }

  return facts;
}
