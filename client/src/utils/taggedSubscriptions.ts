import type { Category } from "../api/client.js";
import { cleanDescription } from "./cleanDescription.js";
import { merchantKey, type Cadence } from "./recurring.js";

/**
 * The subscriptions, which are the ones that have been tagged as such.
 *
 * Not the ones that look like subscriptions. That was three wrong answers in
 * a row — a personal loan, a life policy, then broadband and a phone bill —
 * and the lesson of the third is that the detector was never going to get
 * there. It finds payments that come back on a rhythm for a consistent
 * amount, and a loan instalment, a premium, a phone bill and the bins are all
 * exactly that shape. The difference between "something I signed up to and
 * could stop" and "something I owe every month" is not in the transactions at
 * all. It is in what the household means by them, and the only thing in this
 * app that holds that meaning is the category they were filed under.
 *
 * So membership comes from the tag and nothing else. What the charges are
 * still asked for is **description** — how often, how much a year, when the
 * next one is due — because that the data genuinely can support. The split
 * matters: a subscription tagged once and charged once is still a
 * subscription and still appears, with "only one charge so far" where the
 * cadence would be, rather than being silently withheld until it has earned
 * its place in a pattern.
 */

export interface TaggedSubscription {
  /** Stable across renders, and the key a review is recorded against. */
  key: string;
  label: string;
  categoryId: number;
  categoryName: string;
  /** Oldest first. */
  charges: { date: string; amount: number }[];
  occurrences: number;
  lastCharged: string;
  /** The typical charge, as a positive number. */
  amount: number;
  /** Null when there are too few charges to say how often it comes. */
  cadence: Cadence | null;
  /** Null for the same reason — an unknown rhythm has no monthly cost. */
  monthly: number | null;
  annual: number | null;
}

interface Taggable {
  amount: number;
  booking_date: string;
  description: string | null;
  counterparty: string | null;
  category_id: number | null;
}

/** The same cadences the detector uses, so the two never disagree on naming. */
const CADENCES: { cadence: Cadence; days: number; tolerance: number; perYear: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 2, perYear: 52 },
  { cadence: "monthly", days: 30.4, tolerance: 6, perYear: 12 },
  { cadence: "quarterly", days: 91, tolerance: 12, perYear: 4 },
  { cadence: "yearly", days: 365, tolerance: 30, perYear: 1 },
];

/**
 * Two gaps, so three charges.
 *
 * One gap is not a rhythm — a pair of payments a month apart describes a
 * monthly subscription exactly as well as it describes two unrelated payments
 * — and claiming a cadence from it would put an annual cost on screen that is
 * twelve times a guess.
 */
const MIN_FOR_CADENCE = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** The categories the owner has said hold subscriptions. */
export function subscriptionCategories(categories: Category[]): Category[] {
  return categories.filter((category) => category.is_subscription);
}

export function taggedSubscriptions(transactions: Taggable[], categories: Category[]): TaggedSubscription[] {
  const tagged = new Map(subscriptionCategories(categories).map((category) => [category.id, category]));
  if (tagged.size === 0) return [];

  const groups = new Map<string, { label: string; category: Category; rows: Taggable[] }>();

  for (const tx of transactions) {
    // Outflows only. A refund from a provider is filed under the same
    // category and is not a subscription being paid — counting it would show
    // a negative charge in the history and pull the typical amount down.
    if (tx.amount >= 0) continue;
    if (tx.category_id == null) continue;
    const category = tagged.get(tx.category_id);
    if (!category) continue;

    // Grouped by merchant the way the detector groups them, so one provider's
    // store numbers and payment references do not become twelve
    // subscriptions. The key is also what a review is recorded against.
    const key = merchantKey(tx);
    if (key.length < 3) continue;

    const label = cleanDescription(tx.description) || tx.counterparty || key;
    const entry = groups.get(key) ?? { label, category, rows: [] };
    entry.rows.push(tx);
    groups.set(key, entry);
  }

  const found: TaggedSubscription[] = [];

  for (const [key, entry] of groups) {
    const ordered = [...entry.rows].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const amounts = ordered.map((tx) => Math.abs(tx.amount));
    const amount = median(amounts);
    const latest = ordered[ordered.length - 1];

    let cadence: Cadence | null = null;
    if (ordered.length >= MIN_FOR_CADENCE) {
      const gaps: number[] = [];
      for (let i = 1; i < ordered.length; i++) {
        const gap = (Date.parse(ordered[i].booking_date) - Date.parse(ordered[i - 1].booking_date)) / 86_400_000;
        if (gap > 0) gaps.push(gap);
      }
      const spacing = median(gaps);
      cadence = CADENCES.find((c) => Math.abs(spacing - c.days) <= c.tolerance)?.cadence ?? null;
    }

    const perYear = cadence ? (CADENCES.find((c) => c.cadence === cadence)?.perYear ?? null) : null;

    found.push({
      key,
      // The tidiest of the descriptions rather than the first seen: a
      // provider that changed how it writes its name should read as it does
      // now, not as it did two years ago.
      label: cleanDescription(latest.description) || latest.counterparty || entry.label,
      categoryId: entry.category.id,
      categoryName: entry.category.name,
      charges: ordered.map((tx) => ({ date: tx.booking_date, amount: Math.abs(tx.amount) })),
      occurrences: ordered.length,
      lastCharged: latest.booking_date,
      amount,
      cadence,
      monthly: perYear ? (amount * perYear) / 12 : null,
      annual: perYear ? amount * perYear : null,
    });
  }

  // Dearest a year first where that is known, then the ones whose rhythm is
  // not established yet. The page re-sorts by neglect; this only decides what
  // comes first among equals.
  return found.sort((a, b) => (b.annual ?? -1) - (a.annual ?? -1) || a.label.localeCompare(b.label));
}
