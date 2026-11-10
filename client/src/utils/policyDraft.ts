import type { NetWorthSource, Policy, PolicyFacts } from "../api/client.js";

/**
 * The shape of a policy being typed in, and the conversions either side of it.
 *
 * It exists so there is exactly one list of what a policy consists of. Policies
 * arrive two ways — read out of a statement, or typed in by hand — and those
 * were always going to be two screens. Two screens with their own field lists
 * would drift, and the drift is silent: a field added to the import path and
 * forgotten on the manual one doesn't break anything, it just quietly becomes
 * impossible to record by hand.
 *
 * Everything is a string here, because that is what an input holds. The
 * conversions below are where a string becomes a figure, a date, or nothing at
 * all, and they are the only place that decision is made.
 */

export interface PolicyDraftFields {
  name: string;
  insurer: string;
  policyNumber: string;
  currency: string;
  coverAmount: string;
  surrenderValue: string;
  valuedAt: string;
  premium: string;
  premiumFrequency: "" | "monthly" | "quarterly" | "annual";
  startDate: string;
  maturityDate: string;
  netWorthSource: NetWorthSource;
}

/** Which groups of fields a given screen is collecting. */
export interface PolicyBlocks {
  /** Name, insurer, policy number, currency. */
  identity: boolean;
  /** Cover amount, surrender value, and the date they were true on. */
  figures: boolean;
  /** Started and matures. */
  term: boolean;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A typed-in amount, or a refusal.
 *
 * Three outcomes, mirroring the server's own `money()` — and the third is why
 * this isn't just `Number(value)`. An unreadable figure has to be *rejected*,
 * not quietly turned into "no figure": a mistyped cover amount that saves as
 * blank looks identical to a term policy with no cash value, and the owner
 * would have no way of telling that what they typed never arrived.
 */
export type ParsedMoney = { ok: true; value: number | null } | { ok: false };

/**
 * Thousands separators and the spaces some statements use instead.
 *
 * `\s` is enough for the spaces: in JavaScript it already matches a
 * non-breaking space, which is what a figure pasted out of a PDF arrives with.
 */
const NOISE = /[,\s]/g;

/**
 * A leading currency symbol, and nothing more.
 *
 * Narrow on purpose. A general "strip anything before the digits" eats whole
 * words — "lots" strips to nothing, which this function would then report as
 * an empty box, which is the exact silent loss it exists to prevent. The `R`
 * is South African rand and only counts immediately before a digit, so "Rand"
 * is still refused rather than read as "and".
 */
const CURRENCY_PREFIX = /^(?:[$£€¥₹]+|R(?=[\d.]))/i;

/**
 * Digits, with at most one decimal point.
 *
 * `Number()` on its own is far too willing: it accepts "0x1f", "1e9" and
 * "Infinity", none of which anybody meant to type into a cover amount.
 */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export function parseMoney(value: string): ParsedMoney {
  // A figure copied off a statement arrives with separators and a symbol on
  // it, and making someone retype it is not a safety feature.
  const trimmed = value.trim().replace(NOISE, "").replace(CURRENCY_PREFIX, "");
  if (trimmed === "") return { ok: true, value: null };
  // A minus sign fails DECIMAL, which is the intent: a policy has no negative
  // cover, so one means the entry was not understood.
  if (!DECIMAL.test(trimmed)) return { ok: false };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

/** A three-letter ISO code, or null when it isn't one. */
export function parseCurrency(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function emptyDraft(currency = "EUR"): PolicyDraftFields {
  return {
    name: "",
    insurer: "",
    policyNumber: "",
    currency,
    coverAmount: "",
    surrenderValue: "",
    // A figure typed in today is a figure known today. Editable, because
    // somebody entering an older statement should be able to say so.
    valuedAt: today(),
    premium: "",
    premiumFrequency: "",
    startDate: "",
    maturityDate: "",
    // Never guessed. A policy stays out of every total until it is explicitly
    // asked in — see utils/policyValue.ts.
    netWorthSource: "none",
  };
}

/**
 * A name that tells one benefit from another.
 *
 * Two death benefits on one schedule routinely share a policy number, so the
 * number cannot do this on its own — the document's own benefit number is what
 * separates them, and failing that their position in the document. The insurer
 * alone would give both the same name and leave the owner guessing which card
 * was which.
 */
export function benefitLabel(facts: PolicyFacts, index: number): string {
  const insurer = facts.insurer ?? "Life policy";
  if (facts.siblings <= 1) return insurer;

  const numbered = facts.benefitName?.match(/benefit\s*(?:number\s*)?(\d+)/i);
  return numbered ? `${insurer} — benefit ${numbered[1]}` : `${insurer} — ${index + 1}`;
}

export function draftFromFacts(facts: PolicyFacts, existing?: Policy | null, index = 0): PolicyDraftFields {
  return {
    ...emptyDraft(),
    name: existing?.name ?? benefitLabel(facts, index),
    insurer: existing?.insurer ?? facts.insurer ?? "",
    policyNumber: existing?.policy_number ?? facts.policyNumber ?? "",
    currency: existing?.currency ?? facts.currency ?? "USD",
    coverAmount: facts.coverAmount ? String(facts.coverAmount.value) : "",
    surrenderValue: facts.surrenderValue ? String(facts.surrenderValue.value) : "",
    // A statement with no stated "as at" is dated today: the figure became
    // known now, which is the honest claim available.
    valuedAt: facts.valuedAt?.value ?? today(),
    premium: facts.premium ? String(facts.premium.value) : "",
    premiumFrequency: facts.premiumFrequency ?? "",
    startDate: facts.startDate?.value ?? "",
    maturityDate: facts.maturityDate?.value ?? "",
    netWorthSource: existing?.net_worth_source ?? "none",
  };
}

/**
 * An existing policy, back into the form.
 *
 * The figures come along so an edit screen can show what is on record, but see
 * `toPatch` for why they are not what it sends back.
 */
export function draftFromPolicy(policy: Policy): PolicyDraftFields {
  return {
    name: policy.name,
    insurer: policy.insurer ?? "",
    policyNumber: policy.policy_number ?? "",
    currency: policy.currency,
    coverAmount: policy.cover_amount != null ? String(policy.cover_amount) : "",
    surrenderValue: policy.surrender_value != null ? String(policy.surrender_value) : "",
    valuedAt: policy.valued_at ?? today(),
    premium: policy.premium != null ? String(policy.premium) : "",
    premiumFrequency: policy.premium_frequency ?? "",
    startDate: policy.start_date ?? "",
    maturityDate: policy.maturity_date ?? "",
    netWorthSource: policy.net_worth_source,
  };
}

/**
 * What is wrong with the draft, in the order a person would fix it, or null.
 *
 * Only checks the blocks a screen is actually showing: an edit screen that
 * doesn't collect the figures must not refuse to save because of one.
 */
export function draftProblem(draft: PolicyDraftFields, blocks: PolicyBlocks): string | null {
  if (blocks.identity) {
    if (!draft.name.trim()) return "Give the policy a name.";
    if (parseCurrency(draft.currency) === null) return "Currency should be a three-letter code, like EUR or ZAR.";
  }

  if (blocks.figures) {
    if (!parseMoney(draft.coverAmount).ok) return "That cover amount isn't a number.";
    if (!parseMoney(draft.surrenderValue).ok) return "That surrender value isn't a number.";
    if (!draft.valuedAt) return "Give the date those figures were true on.";
  }

  if (!parseMoney(draft.premium).ok) return "That premium isn't a number.";
  // A premium with no frequency is not a cost — it can't be turned into a
  // monthly figure, so the plan would simply drop it.
  if (draft.premium.trim() !== "" && !draft.premiumFrequency) return "Say how often that premium is paid.";

  if (blocks.term && draft.startDate && draft.maturityDate && draft.maturityDate < draft.startDate) {
    return "The maturity date is before the start date.";
  }

  return null;
}

/** A figure that has already passed `draftProblem`. */
function money(value: string): number | null {
  const parsed = parseMoney(value);
  return parsed.ok ? parsed.value : null;
}

export function toCreate(draft: PolicyDraftFields, extract?: unknown) {
  return {
    name: draft.name.trim() || "Life policy",
    insurer: draft.insurer.trim() || null,
    policy_number: draft.policyNumber.trim() || null,
    currency: parseCurrency(draft.currency) ?? "EUR",
    cover_amount: money(draft.coverAmount),
    surrender_value: money(draft.surrenderValue),
    valued_at: draft.valuedAt || null,
    premium: money(draft.premium),
    premium_frequency: draft.premiumFrequency || null,
    start_date: draft.startDate || null,
    maturity_date: draft.maturityDate || null,
    net_worth_source: draft.netWorthSource,
    ...(extract === undefined ? {} : { extract }),
  };
}

/**
 * What an edit sends — and deliberately not the two figures.
 *
 * `cover_amount` and `surrender_value` are the one pair that must never be
 * PATCHed. The card's headline reads the policy's own columns, while the net
 * worth *trend* reads the valuation history (`policyContributionsAt` in
 * utils/policyValue.ts). Patching a figure moves the first and not the second,
 * and the two disagree from then on with nothing on screen to say why. A
 * changed figure is a new valuation, which is what `toValuation` is for.
 */
export function toPatch(draft: PolicyDraftFields) {
  return {
    name: draft.name.trim() || "Life policy",
    insurer: draft.insurer.trim() || null,
    policy_number: draft.policyNumber.trim() || null,
    currency: parseCurrency(draft.currency) ?? "EUR",
    premium: money(draft.premium),
    premium_frequency: draft.premiumFrequency || null,
    start_date: draft.startDate || null,
    maturity_date: draft.maturityDate || null,
  };
}

export function toValuation(draft: PolicyDraftFields) {
  return {
    valued_at: draft.valuedAt || today(),
    cover_amount: money(draft.coverAmount),
    surrender_value: money(draft.surrenderValue),
    premium: money(draft.premium),
    premium_frequency: draft.premiumFrequency || null,
  };
}
