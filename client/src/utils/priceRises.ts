import { cleanDescription } from "./cleanDescription.js";
import { merchantKey } from "./recurring.js";

/**
 * Subscriptions that quietly went up.
 *
 * This is as close as software gets to the "bill negotiation" the paid apps
 * sell. That is a call centre — a person rings your provider and haggles for
 * a share of the saving — and no amount of code performs it. What code can do
 * is the part that makes the call worth making: notice that a charge rose,
 * say by how much, and put a year's worth of the increase next to it, because
 * "it went up £3" and "that is £36 a year" are the same fact and only one of
 * them gets acted on.
 *
 * Deliberately separate from `detectRecurring`, which will not see this at
 * all: it only groups charges within 20% of each other, so a real price rise
 * splits the group rather than appearing inside it. The very thing worth
 * knowing is invisible to the detector built for the neighbouring job.
 */

export interface PriceRise {
  key: string;
  label: string;
  /** What it used to charge, as a positive number. */
  was: number;
  /** What it charges now. */
  now: number;
  increase: number;
  /** As a fraction — 0.12 is up 12%. */
  fraction: number;
  /** When the higher charge first appeared. */
  since: string;
  /** What the increase alone costs over a year at this cadence. */
  annualIncrease: number;
  /** How many charges established the old price. */
  priorCharges: number;
}

interface Chargeable {
  amount: number;
  booking_date: string;
  description: string | null;
  counterparty: string | null;
}

/** Enough history to establish what the old price *was*. */
const MIN_PRIOR_CHARGES = 3;

/**
 * How closely the old charges must agree before this counts as a price rather
 * than a habit. A merchant you happen to visit for varying sums has no price
 * to rise.
 */
const PRIOR_CONSISTENCY = 0.1;

/** Below this a change is rounding, a card fee or a leap-year day count. */
const MIN_RISE = 0.04;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Charges per year, snapped to a cadence somebody would recognise.
 *
 * Billing dates land on working days, so a monthly subscription's median gap
 * comes out at 30 or 31 and the raw arithmetic says 11.8 charges a year. That
 * turns a £3 rise into "£35.32 a year", which reads as a measurement rather
 * than a fact and invites arguing with the number instead of the provider.
 * A monthly bill goes up twelve times a year. Anything that matches no
 * cadence falls back to the arithmetic.
 */
const CADENCES: { days: number; tolerance: number; perYear: number }[] = [
  { days: 7, tolerance: 2, perYear: 52 },
  { days: 30.4, tolerance: 6, perYear: 12 },
  { days: 91, tolerance: 12, perYear: 4 },
  { days: 365, tolerance: 30, perYear: 1 },
];

function perYear(dates: string[]): number {
  if (dates.length < 2) return 12;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 12;
  const spacing = median(gaps);
  if (spacing <= 0) return 12;
  return CADENCES.find((c) => Math.abs(spacing - c.days) <= c.tolerance)?.perYear ?? 365 / spacing;
}

export function detectPriceRises(transactions: Chargeable[]): PriceRise[] {
  const groups = new Map<string, Chargeable[]>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const key = merchantKey(tx);
    if (key.length < 3) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const rises: PriceRise[] = [];

  for (const [key, charges] of groups) {
    if (charges.length < MIN_PRIOR_CHARGES + 1) continue;

    const ordered = [...charges].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const latest = ordered[ordered.length - 1];
    const prior = ordered.slice(0, -1);

    const priorAmounts = prior.map((tx) => Math.abs(tx.amount));
    const was = median(priorAmounts);
    const now = Math.abs(latest.amount);
    if (was <= 0) continue;

    // The old charges have to agree with each other, or there was never a
    // price here to rise — just a merchant visited for varying sums.
    const settled = priorAmounts.every((amount) => Math.abs(amount - was) / was <= PRIOR_CONSISTENCY);
    if (!settled) continue;

    const fraction = (now - was) / was;
    if (fraction < MIN_RISE) continue;

    rises.push({
      key,
      label: cleanDescription(latest.description) || latest.counterparty || key,
      was,
      now,
      increase: now - was,
      fraction,
      since: latest.booking_date,
      // The figure that makes it worth a phone call.
      annualIncrease: (now - was) * perYear(ordered.map((tx) => tx.booking_date)),
      priorCharges: prior.length,
    });
  }

  return rises.sort((a, b) => b.annualIncrease - a.annualIncrease);
}
