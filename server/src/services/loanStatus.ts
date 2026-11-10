import Anthropic from "@anthropic-ai/sdk";
import { rawField, verifyDate, verifyNumber, type ExtractedField, type RawPass } from "./loanContract.js";

/**
 * Where a loan stands today, read off a screenshot of the lender's own page.
 *
 * A loan agreement says what was agreed; it never says what is left. That
 * figure lives in the lender's app, and the way anybody actually has it to
 * hand is a screenshot on their phone. So this reads an image, and it is the
 * only reader here that does — `loanContract.ts` reads a PDF, falling back to
 * its pages when there is no text, which is a different thing: that fallback
 * exists for a document that should have had text, while a screenshot never
 * had any and never will.
 *
 * It shares every safeguard with the contract reader rather than reimplementing
 * them — each figure is re-derived from the digits in the quote it came from
 * (`verifyNumber`), so a number the model stated but did not read is dropped.
 * What it cannot share is the quote-appears-in-the-source check, because an
 * image has no source text. The quote is a transcription, and its value is
 * that the person confirming reads it against the picture in front of them.
 *
 * **The figure that matters most is also the one most easily misread.** A
 * lender's "remaining balance" is very often the rest of the instalments
 * rather than the outstanding principal: the balance left works out to an
 * exact number of remaining payments, and so carries every penny of future
 * interest inside it. Storing that as the balance while also recording the
 * interest rate would charge that interest twice over and make every payoff
 * projection wrong — on a high-rate personal loan the overstatement runs to
 * roughly a third of the balance. `reconciles()` below detects exactly that
 * arrangement so the screen can say so instead of quietly getting it wrong.
 */

export interface LoanStatus {
  /** The lender's own reference for the loan, as printed on the page. */
  reference: string | null;
  lender: string | null;
  currency: string | null;

  /** What is left to pay, as the lender words it. See the caution above. */
  remainingBalance: ExtractedField<number> | null;
  /** What has been paid so far. */
  amountPaid: ExtractedField<number> | null;
  /** What was borrowed. */
  loanAmount: ExtractedField<number> | null;
  /** Principal plus all interest over the full term. */
  totalToRepay: ExtractedField<number> | null;

  monthlyPayment: ExtractedField<number> | null;
  interestRate: ExtractedField<number> | null;
  termMonths: ExtractedField<number> | null;
  startDate: ExtractedField<string> | null;
  endDate: ExtractedField<string> | null;

  nextPaymentAmount: ExtractedField<number> | null;
  nextPaymentDate: ExtractedField<string> | null;

  /**
   * True when the figures themselves show that `remainingBalance` is the rest
   * of the instalments rather than the outstanding principal — see above.
   * Derived from the numbers, never from the model's opinion.
   */
  balanceIncludesInterest: boolean;

  /** Always "image" here, and said out loud because quotes are transcribed. */
  readFrom: "image";
}

/** What the API will accept as an image, and what a phone actually produces. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The file's own first bytes, rather than whatever the upload claimed. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // "RIFF" .... "WEBP"
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)) {
    return "image/webp";
  }
  return null;
}

const MODEL = "claude-opus-5";

/**
 * Bounds, so a misread decimal point is refused rather than stored.
 *
 * The rate's ceiling is deliberately high. A rate in the tens of percent looks
 * like a misreading and frequently is not — short-term and subprime personal
 * lending really is priced there — and refusing one would be the reader
 * overruling the page in front of it.
 */
const BOUNDS = {
  money: { min: 0, max: 100_000_000 },
  rate: { min: 0, max: 200 },
  term: { min: 1, max: 600 },
};

const SYSTEM_PROMPT = [
  "You read screenshots of a lender's loan account page and report where the loan stands.",
  "Transcribe the quote for each item exactly as it is printed, including the currency symbol and the digits as spaced or punctuated on screen. The person checking your answer reads that quote against the screenshot, so an approximate or reworded quote makes the figure impossible to confirm.",
  "Report null for anything not visible. Never calculate a missing figure from the others, and never fill one in from what is typical.",
].join(" ");

const PROMPT = [
  "Report where this loan stands, from the screenshot.",
  "",
  "Read the labels as the lender writes them:",
  "- remaining_balance is what the page calls the balance remaining, outstanding or left to pay.",
  "- amount_paid is what has been paid so far, often labelled \"you've paid\".",
  "- loan_amount is the sum borrowed.",
  "- total_to_repay is the whole amount repayable over the term, principal and interest together.",
  "",
  "Do not decide which of these is the outstanding principal — report what is printed under the label it is printed under.",
  "",
  "Dates must be YYYY-MM-DD. A date shown as \"31 Oct 2025\" is 2025-10-31.",
  "The interest rate is a percentage: report the number as printed, even where the page puts a currency symbol in front of it.",
].join("\n");

// `additionalProperties: false` is required on every object by the structured
// output API, not optional tidiness — it rejects the whole request without it.
const field = (type: string, description: string) => ({
  type: ["object", "null"],
  properties: {
    value: { type, description },
    quote: { type: "string", description: "The exact text on screen this was read from" },
  },
  required: ["value", "quote"],
  additionalProperties: false,
});

const SCHEMA = {
  type: "object",
  properties: {
    reference: { type: ["string", "null"], description: "The lender's reference for this loan" },
    lender: { type: ["string", "null"] },
    currency: { type: ["string", "null"], description: "ISO code, e.g. GBP, EUR, ZAR" },
    remaining_balance: field("number", "What the page says is left to pay"),
    amount_paid: field("number", "What has been paid so far"),
    loan_amount: field("number", "The sum borrowed"),
    total_to_repay: field("number", "The whole amount repayable over the term"),
    monthly_payment: field("number", "The regular repayment"),
    interest_rate: field("number", "Annual rate as a percentage"),
    term_months: field("number", "Length of the loan in months"),
    start_date: field("string", "When the loan started, YYYY-MM-DD"),
    end_date: field("string", "When the loan ends, YYYY-MM-DD"),
    next_payment_amount: field("number", "The next payment due"),
    next_payment_date: field("string", "When the next payment is due, YYYY-MM-DD"),
  },
  required: [
    "reference",
    "lender",
    "currency",
    "remaining_balance",
    "amount_paid",
    "loan_amount",
    "total_to_repay",
    "monthly_payment",
    "interest_rate",
    "term_months",
    "start_date",
    "end_date",
    "next_payment_amount",
    "next_payment_date",
  ],
  additionalProperties: false,
} as const;

/**
 * Whether paid-so-far and left-to-pay add up to the whole amount repayable.
 *
 * When they do, "remaining balance" is the rest of the instalments and carries
 * the future interest inside it, so it is not the outstanding principal and
 * must not be fed to anything that will charge interest on it again.
 *
 * Derived from the arithmetic rather than from the label, because the labels
 * differ by lender and the arithmetic does not. A tolerance of a penny or two
 * covers the rounding on a final instalment.
 */
export function reconciles(paid: number | null, remaining: number | null, total: number | null): boolean {
  if (paid == null || remaining == null || total == null) return false;
  return Math.abs(paid + remaining - total) <= 0.02;
}

/**
 * The outstanding principal implied by a balance that includes future
 * interest, or null when it cannot be worked out honestly.
 *
 * This is the present value of the payments still to come. Offered as a
 * suggestion on the confirmation screen and never stored without being
 * agreed to: it assumes the quoted rate is the one actually applied to the
 * balance each month, which is true of a straightforward amortising loan and
 * not true of every product that quotes an APR.
 */
export function impliedPrincipal(remaining: number | null, monthlyPayment: number | null, annualRate: number | null): number | null {
  if (remaining == null || monthlyPayment == null || annualRate == null) return null;
  if (monthlyPayment <= 0 || remaining <= 0) return null;

  const payments = Math.round(remaining / monthlyPayment);
  if (payments < 1 || payments > 600) return null;

  // No interest quoted means the remaining instalments are the principal.
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate <= 0) return remaining;

  const value = monthlyPayment * ((1 - Math.pow(1 + monthlyRate, -payments)) / monthlyRate);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export async function extractLoanStatus(imageBase64: string, mediaType: ImageType): Promise<LoanStatus | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  let parsed: RawPass;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return null;
  }

  return assemble(parsed);
}

/** A plain string from the pass, or null — never an empty one. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function assemble(parsed: RawPass): LoanStatus {
  const money = (key: string) => verifyNumber(rawField(parsed[key]), BOUNDS.money);

  const remainingBalance = money("remaining_balance");
  const amountPaid = money("amount_paid");
  const totalToRepay = money("total_to_repay");

  return {
    reference: text(parsed.reference),
    lender: text(parsed.lender),
    currency: text(parsed.currency)?.toUpperCase().slice(0, 3) ?? null,
    remainingBalance,
    amountPaid,
    loanAmount: money("loan_amount"),
    totalToRepay,
    monthlyPayment: money("monthly_payment"),
    interestRate: verifyNumber(rawField(parsed.interest_rate), BOUNDS.rate),
    termMonths: verifyNumber(rawField(parsed.term_months), BOUNDS.term),
    startDate: verifyDate(rawField(parsed.start_date)),
    endDate: verifyDate(rawField(parsed.end_date)),
    nextPaymentAmount: money("next_payment_amount"),
    nextPaymentDate: verifyDate(rawField(parsed.next_payment_date)),
    balanceIncludesInterest: reconciles(
      amountPaid?.value ?? null,
      remainingBalance?.value ?? null,
      totalToRepay?.value ?? null
    ),
    readFrom: "image",
  };
}
