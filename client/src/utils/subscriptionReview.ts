import type { SubscriptionReview } from "../api/client.js";
import { CADENCE_DAYS, stillLive } from "./forecast.js";
import type { PriceRise } from "./priceRises.js";
import type { Cadence } from "./recurring.js";
import type { TaggedSubscription } from "./taggedSubscriptions.js";

/**
 * Which subscriptions are worth looking at, and in what order.
 *
 * A subscription does not fail by being expensive. It fails by never being
 * questioned: £9.99 is small enough that no month ever forces the issue, so
 * it survives on the fact that nobody has thought about it. The amount is
 * already on the commitments card and is not the thing that surfaces one —
 * the date you last looked is.
 *
 * So the order here is by neglect rather than by cost. The dearest
 * subscription on the list may be the one you are most certain about, and
 * putting it first means the £6 thing you forgot you had never reaches the
 * screen.
 *
 * What is on the list at all is decided before this file runs, by the tag —
 * see `taggedSubscriptions.ts`.
 */

/**
 * How long a confirmation stays good for.
 *
 * A year, because that is the cycle these things actually move on — a price
 * rise, a contract ending, a free trial turning into a bill. Shorter would
 * mean the whole list going stale together every few months, which trains you
 * to clear it without reading, and a list cleared without reading is worse
 * than no list because it leaves a record saying it was checked.
 */
export const REVIEW_GOOD_FOR_DAYS = 365;

export type ReviewFlag =
  /** Charged more than one and a half of its own cycles ago. */
  | "dormant"
  /** The price went up and the rise is still in force. */
  | "rose"
  /** Tagged, but not charged often enough yet to say how often it comes. */
  | "new"
  /** Never confirmed by anybody. */
  | "never-checked"
  /** Confirmed, but long enough ago that it says nothing now. */
  | "stale";

export interface ReviewItem {
  subscription: TaggedSubscription;
  review: SubscriptionReview | null;
  /** Days since it was last confirmed; null when it never has been. */
  checkedDaysAgo: number | null;
  /** When the next charge is due, if the rhythm is known and still running. */
  nextDue: string | null;
  rise: PriceRise | null;
  flags: ReviewFlag[];
  /** What it costs a year, or null where the rhythm is not established yet. */
  annual: number | null;
}

const DAY = 86_400_000;

function daysSince(iso: string, asOf: string): number {
  return Math.floor((Date.parse(asOf) - Date.parse(iso)) / DAY);
}

/**
 * When this should next charge, or null if it looks finished.
 *
 * Deliberately derived from the last charge plus one cycle rather than from a
 * schedule nobody entered. And deliberately null for a dormant one: stepping
 * forward from a year-old charge to produce "due next Tuesday" is the same
 * invention `stillLive` exists to stop in the balance projection. Null too
 * where the cadence is unknown, since a date needs a rhythm to come from.
 */
export function nextCharge(item: { cadence: Cadence | null; lastCharged: string }, asOf: string): string | null {
  if (!item.cadence) return null;
  if (!stillLive({ cadence: item.cadence, lastCharged: item.lastCharged }, asOf)) return null;

  let due = Date.parse(item.lastCharged) + CADENCE_DAYS[item.cadence] * DAY;
  const now = Date.parse(asOf);
  // Already past: step on until it is ahead, which handles a charge that
  // landed a few days early or late without drifting.
  while (due < now) due += CADENCE_DAYS[item.cadence] * DAY;
  return new Date(due).toISOString().slice(0, 10);
}

export function reviewItems(
  subscriptions: TaggedSubscription[],
  reviews: SubscriptionReview[],
  rises: PriceRise[],
  today: string
): ReviewItem[] {
  const byKey = new Map(reviews.map((review) => [review.merchant_key, review]));
  const riseByKey = new Map(rises.map((rise) => [rise.key, rise]));

  const items = subscriptions.map((subscription) => {
    const review = byKey.get(subscription.key) ?? null;
    const checkedDaysAgo = review?.reviewed_at ? daysSince(review.reviewed_at, today) : null;
    const rise = riseByKey.get(subscription.key) ?? null;
    const live = subscription.cadence
      ? stillLive({ cadence: subscription.cadence, lastCharged: subscription.lastCharged }, today)
      : true;

    const flags: ReviewFlag[] = [];
    // Only ever said where a rhythm is known. Without one there is nothing to
    // be overdue against, and calling a newly tagged subscription dormant
    // because it has only charged once would be exactly backwards.
    if (subscription.cadence && !live) flags.push("dormant");
    if (!subscription.cadence) flags.push("new");
    if (rise) flags.push("rose");
    if (checkedDaysAgo == null) flags.push("never-checked");
    else if (checkedDaysAgo >= REVIEW_GOOD_FOR_DAYS) flags.push("stale");

    return {
      subscription,
      review,
      checkedDaysAgo,
      nextDue: nextCharge(subscription, today),
      rise,
      flags,
      annual: subscription.annual,
    };
  });

  return items.sort(byNeglect);
}

/** Longest unexamined first, and anything already answered last. */
function byNeglect(a: ReviewItem, b: ReviewItem): number {
  const urgency = (item: ReviewItem) => {
    if (item.flags.includes("never-checked")) return 0;
    if (item.flags.includes("stale")) return 1;
    return 2;
  };

  const difference = urgency(a) - urgency(b);
  if (difference !== 0) return difference;

  // Within a band, the longest since it was looked at — and the dearest
  // where neither has ever been looked at, since that is all that is left to
  // go on.
  const checked = (item: ReviewItem) => item.checkedDaysAgo ?? Number.POSITIVE_INFINITY;
  if (checked(a) !== checked(b) && Number.isFinite(checked(a) + checked(b))) return checked(b) - checked(a);
  return (b.annual ?? -1) - (a.annual ?? -1);
}

/** How long ago it was looked at, in the words somebody would use. */
export function checkedPhrase(days: number | null): string {
  if (days == null) return "Never checked";
  if (days === 0) return "Checked today";
  if (days < 31) return `Checked ${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30.4);
  if (months < 18) return `Checked ${months} ${months === 1 ? "month" : "months"} ago`;
  return `Checked ${Math.round(days / 365)} years ago`;
}
