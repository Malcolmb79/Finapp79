import { cleanDescription } from "./cleanDescription.js";

/**
 * Finds the payments that come back every month.
 *
 * Subscriptions are the thing personal finance tools surface that a category
 * total can't: £9.99 filed under Entertainment looks like any other evening
 * out, and only shows itself as a standing commitment when you see it has
 * been charged nine months running.
 *
 * Detection is by cadence and amount rather than by a list of known
 * merchants, so it finds the gym and the accountant as readily as Netflix.
 */

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringPayment {
  /** Stable across renders and unique per merchant — for selection and keys. */
  key: string;
  label: string;
  cadence: Cadence;
  /** The typical charge, as a positive number. */
  amount: number;
  /** How many charges were seen. */
  occurrences: number;
  lastCharged: string;
  /** What it costs over a year at this cadence. */
  annualised: number;
  /** What it costs in an average month, whatever its cadence. */
  monthly: number;
  /** The charges themselves, oldest first, so the history can be shown. */
  charges: { date: string; amount: number }[];
}

interface Chargeable {
  amount: number;
  booking_date: string;
  description: string | null;
  counterparty: string | null;
}

// Days between charges, and how far either side still counts. Monthly is
// generous because month lengths vary and billing dates land on working days.
const CADENCES: { cadence: Cadence; days: number; tolerance: number; perYear: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 2, perYear: 52 },
  { cadence: "monthly", days: 30.4, tolerance: 6, perYear: 12 },
  { cadence: "quarterly", days: 91, tolerance: 12, perYear: 4 },
  { cadence: "yearly", days: 365, tolerance: 30, perYear: 1 },
];

// Three charges is the fewest that can establish a rhythm — two are just two
// payments, and every pair of anything looks regular.
const MIN_OCCURRENCES = 3;

// A subscription's price moves (a rise, a currency wobble) but not by much.
// Beyond this the merchant is somewhere you happen to shop repeatedly.
const AMOUNT_TOLERANCE = 0.2;

/**
 * A merchant name reduced to what stays the same between charges.
 *
 * Card descriptions carry references, dates and locations that differ every
 * time — "TESCO STORES 3288" and "TESCO STORES 4471" are one merchant, and
 * treating them as two hides the pattern entirely.
 */
export function merchantKey(tx: Chargeable): string {
  const raw = cleanDescription(tx.description) || tx.counterparty || "";
  return raw
    .toLowerCase()
    .replace(/\b\d[\d,.]*\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

export function detectRecurring(transactions: Chargeable[]): RecurringPayment[] {
  const groups = new Map<string, Chargeable[]>();
  for (const tx of transactions) {
    // Money out only: a salary is regular too, but it isn't a subscription
    // and listing it among outgoings would misread the total.
    if (tx.amount >= 0) continue;
    const key = merchantKey(tx);
    if (key.length < 3) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const found: RecurringPayment[] = [];

  for (const [key, charges] of groups) {
    if (charges.length < MIN_OCCURRENCES) continue;

    const ordered = [...charges].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i++) {
      gaps.push(daysBetween(ordered[i - 1].booking_date, ordered[i].booking_date));
    }
    // Same-day duplicates would drag the median to zero and match nothing.
    const spacing = median(gaps.filter((gap) => gap > 0));
    if (!Number.isFinite(spacing) || spacing <= 0) continue;

    const match = CADENCES.find((c) => Math.abs(spacing - c.days) <= c.tolerance);
    if (!match) continue;

    const amounts = ordered.map((tx) => Math.abs(tx.amount));
    const typical = median(amounts);
    if (typical <= 0) continue;
    // Every charge has to be close to the typical one. A merchant billed
    // monthly for wildly different sums is a shop with a habit, not a
    // subscription.
    const consistent = amounts.every((amount) => Math.abs(amount - typical) / typical <= AMOUNT_TOLERANCE);
    if (!consistent) continue;

    found.push({
      key,
      // The tidiest of the descriptions rather than the stripped key, which
      // is for matching and reads as a fragment.
      label: cleanDescription(ordered[ordered.length - 1].description) || ordered[ordered.length - 1].counterparty || key,
      cadence: match.cadence,
      amount: typical,
      occurrences: ordered.length,
      lastCharged: ordered[ordered.length - 1].booking_date,
      annualised: typical * match.perYear,
      // What it costs in an average month whatever its cadence, so a yearly
      // insurance and a monthly streaming bill can be added together.
      monthly: (typical * match.perYear) / 12,
      charges: ordered.map((tx) => ({ date: tx.booking_date, amount: Math.abs(tx.amount) })),
    });
  }

  return found.sort((a, b) => b.annualised - a.annualised);
}
