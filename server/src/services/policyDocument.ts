import Anthropic from "@anthropic-ai/sdk";
import {
  chunk,
  collectKeyTerms,
  groundQuote,
  rawField,
  verifyDate,
  verifyNumber,
  type ExtractedField,
  type KeyTerm,
  type RawPass,
} from "./loanContract.js";
import type { UploadedImage } from "./imageBytes.js";

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
 *
 * ## Scanned documents
 *
 * Insurers post these, and a posted letter comes back as a photograph of a
 * page. `extractPdfText` returns nothing for one — a Momentum premium-increase
 * letter with the whole benefit schedule on page two extracted to a single
 * character — and the reader above had nothing to read, so the upload was
 * refused as unreadable while the figures sat there in plain sight.
 *
 * `extractPolicyFactsFromScan` sends the PDF itself instead, and the model
 * reads the pages as images. What that costs is exactly one safeguard: there
 * is no extracted text, so `quoteAppearsIn` has nothing to check a quote
 * against. Everything else is unchanged — the value is still re-derived from
 * the quote by code, still range-checked, surrender is still kept apart from
 * cover, and nothing is written until a person has confirmed it. `readFrom`
 * records which path ran so the confirmation can say the quotes were not
 * cross-checked, rather than presenting both kinds of read as equally
 * verified.
 */

const MODEL = "claude-opus-5";

/**
 * One policy read out of a document.
 *
 * A reader returns a list of these, because one document regularly describes
 * more than one: a life policy schedule often carries a death benefit per life
 * assured, each with its own cover amount. The document-level facts — insurer,
 * currency, key terms, how it was read — are repeated on each, so a single
 * policy is exactly what it always was and a caller that wants one can take
 * the first without unwrapping anything.
 */
export interface PolicyFacts {
  insurer: string | null;
  policyNumber: string | null;
  /**
   * What the document calls this benefit, when it names them.
   *
   * The thing that tells two benefits apart when they share a policy number,
   * which on a schedule covering two lives they usually do.
   */
  benefitName: string | null;
  currency: string | null;
  /** Sum assured — what pays out on death. Protection, never wealth. */
  coverAmount: ExtractedField<number> | null;
  /** Cash/fund/surrender value — what it is worth if cashed in today. */
  surrenderValue: ExtractedField<number> | null;
  premium: ExtractedField<number> | null;
  premiumFrequency: "monthly" | "quarterly" | "annual" | null;
  /**
   * A premium the document states only as a combined figure across benefits.
   *
   * Kept apart from `premium` rather than divided between the policies. A
   * schedule that quotes one total for two benefits has not said what either
   * costs, and splitting it evenly would be inventing the answer. Set only
   * when the document gives no per-benefit premium, so a screen can show what
   * was actually stated and let the figures be assigned by someone who knows.
   */
  totalPremium: ExtractedField<number> | null;
  totalPremiumFrequency: "monthly" | "quarterly" | "annual" | null;
  /** How many policies the document described in all, this one included. */
  siblings: number;
  startDate: ExtractedField<string> | null;
  maturityDate: ExtractedField<string> | null;
  /** The date the figures above were true on — a statement's "as at". */
  valuedAt: ExtractedField<string> | null;
  keyTerms: KeyTerm[];
  /** Set when the document was long enough to be read in more than one pass. */
  passes: number;
  /**
   * `"text"` when the quotes were checked against the document's own text,
   * `"scan"` when there was none to check them against. The difference is
   * worth showing the person confirming the figures.
   */
  readFrom: "text" | "scan";
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

/**
 * One policy or benefit, as the document describes it.
 *
 * Separate from the document around it because a schedule routinely covers
 * more than one. A single life policy can carry two death benefits, one per
 * life assured, each with its own cover and sometimes its own premium — and
 * reading such a document into one set of fields produced something that was
 * not either of them: the cover of the first benefit beside the premium of
 * both. Nothing on screen looked wrong, which is what made it worth fixing.
 */
const POLICY_ITEM = {
  type: "object",
  properties: {
    policy_number: { type: ["string", "null"], description: "The policy or benefit number, exactly as printed" },
    insurer: {
      type: ["string", "null"],
      description:
        "The company this particular policy is with, when the document covers more than one insurer. Null where every policy in it is with the same company.",
    },
    benefit_name: {
      type: ["string", "null"],
      description:
        "What the document calls this benefit, e.g. 'Death Benefit - Life 1'. This is how two benefits sharing one policy number are told apart, so give it whenever the document names them.",
    },
    cover_amount: field(
      "number",
      "The sum assured / cover amount / benefit payable on death FOR THIS BENEFIT ONLY, as a plain number. NOT any cash or fund value, and never a total across benefits."
    ),
    surrender_value: field(
      "number",
      "The surrender value / cash value / fund value / investment value — what this policy is worth if cashed in today, as a plain number. Null for a pure risk or term policy, which has none."
    ),
    premium: field(
      "number",
      "The recurring premium FOR THIS BENEFIT ONLY, as a plain number. Null where the document gives only a combined or total premium across benefits — report that as total_premium instead, never here."
    ),
    // Enum with no sibling `type`. Declaring both is rejected outright —
    // "Enum value 'monthly' does not match declared type '['string','null']'"
    // — because the enum's values are checked against the union rather than
    // against each member of it. The enum alone already constrains the value,
    // and null is one of the permitted ones.
    premium_frequency: { enum: ["monthly", "quarterly", "annual", null] },
    start_date: field("string", "Date the policy commenced, as YYYY-MM-DD"),
    maturity_date: field("string", "Date the policy matures or expires, as YYYY-MM-DD"),
    valued_at: field("string", "The 'as at' date the values on this statement were calculated, as YYYY-MM-DD"),
  },
  required: [
    "policy_number",
    "insurer",
    "benefit_name",
    "cover_amount",
    "surrender_value",
    "premium",
    "premium_frequency",
    "start_date",
    "maturity_date",
    "valued_at",
  ],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    insurer: { type: ["string", "null"], description: "The insurance company's name" },
    currency: { type: ["string", "null"], description: "ISO code, e.g. ZAR, GBP, EUR" },
    policies: {
      type: "array",
      description:
        "One entry per distinct policy or benefit the document describes. A schedule listing two death benefits has two entries, even when they share a policy number.",
      items: POLICY_ITEM,
    },
    total_premium: field(
      "number",
      "A premium the document states as a combined or total figure across all the benefits, as a plain number. Null when every premium is stated per benefit."
    ),
    total_premium_frequency: { enum: ["monthly", "quarterly", "annual", null] },
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
  required: ["insurer", "currency", "policies", "total_premium", "total_premium_frequency", "key_terms"],
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

const DISTINCTION = [
  "The cover amount and the surrender value are different things and must never be confused: the cover amount (sum assured) is paid out on death, while the surrender value (also called cash value, fund value or investment value) is what the policy is worth if cashed in today.",
  "A term or pure risk policy has a cover amount and no surrender value. Where the document states no cash, fund or surrender value, report surrender_value as null — never repeat the cover amount there.",
  "One document often describes more than one policy or benefit: a schedule may list a death benefit for each life assured. Report one entry in policies for each, even where they share a policy number, and name each in benefit_name. Never merge two benefits into one entry, and never put one benefit's cover beside another's premium.",
  "Where a premium is stated only as a combined or total figure across benefits, report it as total_premium and leave each policy's own premium null. Do not divide a total between benefits.",
  "A broker's statement can list policies from several different companies. Give each policy its own insurer where they differ, and never report a single insurer made by joining two companies' names together.",
];

const SYSTEM_PROMPT = [
  "You read life insurance policy statements and schedules, and report what they state.",
  "Quote the exact wording each item comes from, copied character for character from the document — the quotes are checked against the source text, and an item whose quote cannot be found there is discarded.",
  "A figure you cannot point at in the document must be reported as null rather than inferred, calculated, or filled in from what is typical.",
  ...DISTINCTION,
].join(" ");

/**
 * The same job, done from page images.
 *
 * The quote cannot be checked against extracted text here, so the instruction
 * about it changes from "we will check this" to what the quote is actually for
 * on this path: it is what the person confirming the figures reads against the
 * page in front of them. Transcribing it faithfully is the whole of its value.
 */
const SCAN_SYSTEM_PROMPT = [
  "You read life insurance policy statements and schedules, and report what they state.",
  "This document is a scan, so you are reading the pages as images. Read every page, including tables and benefit schedules, which is usually where the figures are.",
  "Transcribe the quote for each item exactly as it is printed, including the currency symbol and the digits as spaced or punctuated on the page. The person checking your answer reads that quote against the page, so an approximate or reworded quote makes the figure impossible to confirm.",
  "A figure you cannot see on a page must be reported as null rather than inferred, calculated, or filled in from what is typical.",
  ...DISTINCTION,
].join(" ");

function buildPrompt(part: string, index: number, total: number): string {
  return [
    total > 1
      ? `Extract the policies this document describes. This is section ${index + 1} of ${total} — report only what appears in this section and null for the rest.`
      : "Extract the policies this document describes.",
    "",
    "Report null for anything the document does not state. Do not calculate a missing field from the others.",
    "",
    "List one entry in policies for every distinct policy or benefit. A schedule showing two death benefits — one per life assured — has two entries, even when one policy number covers both. Give each a benefit_name from the document's own wording so they can be told apart, and never combine two into one entry.",
    "",
    "cover_amount is the benefit paid on death, for that benefit alone. surrender_value is what the policy is worth if cashed in today — look for 'surrender value', 'cash value', 'fund value', 'investment value' or 'policy value'. If the document gives no such figure, surrender_value is null.",
    "",
    "For key_terms, list what the policyholder should know beyond the headline figures: exclusions, waiting periods, premium escalation or review terms, cessions, loans taken against the policy, what happens if a premium is missed, beneficiaries. Leave it empty if the section states none.",
    // The scanned path passes no text — the document is attached to the
    // message instead, so there is nothing to append and no separator to
    // dangle beneath the instructions.
    ...(part ? ["", "---", part] : []),
  ].join("\n");
}

type PromptContent = Parameters<Anthropic["messages"]["create"]>[0]["messages"][number]["content"];

async function readPass(client: Anthropic, content: PromptContent, system: string) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system,
    messages: [{ role: "user", content }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  return JSON.parse(block.text);
}

export async function extractPolicyFacts(text: string): Promise<PolicyFacts[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const parts = chunk(text);
  // Sequential, like the contract reader: a policy schedule is one pass in
  // practice, and this runs while someone waits on a modal.
  const results: RawPass[] = [];
  for (const [index, part] of parts.entries()) {
    const parsed = await readPass(client, buildPrompt(part, index, parts.length), SYSTEM_PROMPT);
    if (parsed) results.push(parsed);
  }
  return assemble(results, text, parts.length);
}

/**
 * Reads a policy document that has no extractable text, from the PDF itself.
 *
 * One pass, never chunked: there is no text to split on, and the page count of
 * a policy schedule sits far inside what a single request takes.
 */
export async function extractPolicyFactsFromScan(pdfBase64: string): Promise<PolicyFacts[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const parsed = await readPass(
    client,
    [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
      { type: "text", text: buildPrompt("", 0, 1) },
    ],
    SCAN_SYSTEM_PROMPT
  );
  return assemble(parsed ? [parsed] : [], null, 1);
}

/**
 * Reads a statement photographed or screenshotted rather than filed.
 *
 * The way most people have a policy schedule to hand is a picture of it on a
 * phone, and the reader refused exactly that: a PNG is not a PDF, so it fell
 * through to being decoded as text, came out as noise, and was reported as
 * having nothing readable in it — for a picture a person could read perfectly
 * well.
 *
 * Every picture goes into one request rather than one each. Pages
 * photographed separately still belong to one document, and read apart they
 * would produce a policy per page, each missing whatever sat on the others —
 * a schedule that names the benefit on one page and prices it on the next is
 * the normal case, not an awkward one.
 */
export async function extractPolicyFactsFromImages(images: UploadedImage[]): Promise<PolicyFacts[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (images.length === 0) return null;

  const client = new Anthropic();
  const parsed = await readPass(
    client,
    [
      ...images.map((image) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
      })),
      {
        type: "text" as const,
        text: [
          images.length > 1
            ? `These ${images.length} pictures are pages of one statement, in order. Read them together: a benefit named on one page may be priced on another.`
            : "",
          buildPrompt("", 0, 1),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    SCAN_SYSTEM_PROMPT
  );
  return assemble(parsed ? [parsed] : [], null, 1);
}

/**
 * Turns raw passes into checked facts.
 *
 * `text` is the document's own text, or null when it had none to extract and
 * the pages were read as images. That is the single difference between the two
 * paths: with text, a quote must be found in it; without, the quote stands on
 * its own and is shown to the person to check. Every other test below runs
 * either way.
 */
export function assemble(results: RawPass[], text: string | null, passes: number): PolicyFacts[] | null {
  if (results.length === 0) return null;

  /**
   * The entry with its quote checked against the document, and widened where
   * it was too short to say what the figure is — a statement's summary block
   * puts the label and its value on separate lines, so a faithful quote of the
   * value is a handful of characters. See `groundQuote`. Null text means a
   * scan, where there is nothing to check against.
   */
  const grounded = (raw: unknown): { value: unknown; quote: string } | null => {
    const entry = rawField(raw);
    if (!entry || typeof entry.quote !== "string") return null;
    if (text === null) return { value: entry.value, quote: entry.quote };
    const quote = groundQuote(entry.quote, text);
    return quote === null ? null : { value: entry.value, quote };
  };

  const first = <T>(pick: (parsed: RawPass) => T | null): T | null => {
    for (const parsed of results) {
      const value = pick(parsed);
      if (value) return value;
    }
    return null;
  };

  /** A `{ value, quote }` number field, grounded in the document and in range. */
  const readNumber = (raw: unknown, bounds: { min: number; max: number }) => verifyNumber(grounded(raw), bounds);
  const readDate = (raw: unknown) => verifyDate(grounded(raw));

  const frequency = (raw: unknown) =>
    typeof raw === "string" && FREQUENCIES.has(raw) ? (raw as "monthly" | "quarterly" | "annual") : null;

  const insurer = first((p) => (typeof p.insurer === "string" && p.insurer ? p.insurer : null));
  const currency = first((p) => (typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : null));
  const totalPremium = first((p) => readNumber(p.total_premium, LIMITS.premium));
  const totalPremiumFrequency = first((p) => frequency(p.total_premium_frequency));
  const keyTerms = collectKeyTerms(results, text);
  const readFrom = text === null ? "scan" : "text";

  /**
   * Every policy entry across every pass.
   *
   * A long document is read in overlapping sections, so the same benefit can
   * come back from two of them. They are merged on identity below rather than
   * concatenated, or a two-benefit schedule read in three passes would produce
   * six policies.
   */
  const entries: RawPass[] = [];
  for (const parsed of results) {
    if (Array.isArray(parsed.policies)) {
      for (const entry of parsed.policies) {
        if (entry && typeof entry === "object") entries.push(entry as RawPass);
      }
    }
  }
  if (entries.length === 0) return null;

  /**
   * What makes two entries the same policy.
   *
   * The number when there is one, and the benefit's name when there is not —
   * which is the case that matters, because two benefits sharing a policy
   * number are exactly the pair this had to stop merging. Falling back to the
   * cover amount keeps two unnamed, unnumbered benefits apart rather than
   * collapsing them into one.
   */
  const identity = (entry: RawPass): string => {
    const number = typeof entry.policy_number === "string" ? entry.policy_number.trim() : "";
    const name = typeof entry.benefit_name === "string" ? entry.benefit_name.trim().toLowerCase() : "";
    const cover = rawField(entry.cover_amount)?.value;
    return `${number}|${name}|${name || number ? "" : String(cover ?? "")}`;
  };

  const merged = new Map<string, RawPass[]>();
  for (const entry of entries) {
    const key = identity(entry);
    merged.set(key, [...(merged.get(key) ?? []), entry]);
  }

  const policies: PolicyFacts[] = [];
  for (const group of merged.values()) {
    // Within one policy, the same "first non-null wins" rule the document
    // level uses — a section that mentions the benefit without restating a
    // figure must not blank one an earlier section gave.
    const pick = <T>(choose: (entry: RawPass) => T | null): T | null => {
      for (const entry of group) {
        const value = choose(entry);
        if (value) return value;
      }
      return null;
    };

    const coverAmount = pick((e) => readNumber(e.cover_amount, LIMITS.cover));
    const surrenderValue = pick((e) => readNumber(e.surrender_value, LIMITS.surrender));

    const facts: PolicyFacts = {
      // The policy's own insurer wins over the document's. A statement from
      // a broker covers several companies, and taking one name for all of
      // them puts the wrong insurer on the card - worse than none, because it
      // reads as a fact rather than a gap.
      insurer: pick((e) => (typeof e.insurer === "string" && e.insurer ? e.insurer : null)) ?? insurer,
      policyNumber: pick((e) => (typeof e.policy_number === "string" && e.policy_number ? e.policy_number : null)),
      benefitName: pick((e) => (typeof e.benefit_name === "string" && e.benefit_name ? e.benefit_name : null)),
      currency,
      coverAmount,
      surrenderValue: dropConfusedSurrender(coverAmount, surrenderValue),
      premium: pick((e) => readNumber(e.premium, LIMITS.premium)),
      premiumFrequency: pick((e) => frequency(e.premium_frequency)),
      totalPremium,
      totalPremiumFrequency,
      siblings: merged.size,
      startDate: pick((e) => readDate(e.start_date)),
      maturityDate: pick((e) => readDate(e.maturity_date)),
      valuedAt: pick((e) => readDate(e.valued_at)),
      keyTerms,
      passes,
      readFrom,
    };

    // A policy that matures before it starts means one of the two dates was
    // read off the wrong line. Neither can be trusted, so both go — same
    // reasoning as the loan reader's start/end pair.
    if (facts.startDate && facts.maturityDate && facts.maturityDate.value <= facts.startDate.value) {
      facts.startDate = null;
      facts.maturityDate = null;
    }

    policies.push(facts);
  }

  // A lone policy carries no combined premium: with nothing to share it with,
  // a "total" is simply that policy's premium, and leaving it in the other
  // field would have the screen warn about a split that cannot arise.
  if (policies.length === 1 && policies[0].totalPremium && !policies[0].premium) {
    policies[0].premium = policies[0].totalPremium;
    policies[0].premiumFrequency = policies[0].premiumFrequency ?? totalPremiumFrequency;
    policies[0].totalPremium = null;
    policies[0].totalPremiumFrequency = null;
  }

  return policies;
}
