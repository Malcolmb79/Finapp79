import type { Holding } from "../api/client.js";

/**
 * What an investment is worth, and what that is made of.
 *
 * Quantity and price are kept apart all the way through, because only the
 * split says *why* a figure moved. A holding worth 20% more because the price
 * rose and one worth 20% more because more was bought are different facts,
 * and a single value would report them identically.
 */

/** The price in effect on a date — the latest one on or before it. */
export function priceAsAt(holding: Holding, date: string): number | null {
  let latest: { priced_at: string; unit_price: number } | null = null;
  for (const price of holding.prices) {
    if (price.priced_at > date) continue;
    if (!latest || price.priced_at > latest.priced_at) latest = price;
  }
  return latest?.unit_price ?? null;
}

export function latestPrice(holding: Holding): number | null {
  return holding.prices.length === 0 ? null : priceAsAt(holding, "9999-12-31");
}

/**
 * Today's value, or null when the holding has never been priced.
 *
 * Null rather than zero, and the difference matters: a holding nobody has
 * priced yet is unknown, not worthless, and counting it as zero would quietly
 * drag net worth down by the whole of it.
 */
export function holdingValue(holding: Holding): number | null {
  const price = latestPrice(holding);
  return price === null ? null : price * holding.quantity;
}

/** What it cost, or null when no cost basis was recorded. */
export function holdingCost(holding: Holding): number | null {
  return holding.unit_cost == null ? null : holding.unit_cost * holding.quantity;
}

export interface Gain {
  absolute: number;
  /** As a fraction — 0.15 is up 15%. Null when the cost was zero. */
  fraction: number | null;
}

export function holdingGain(holding: Holding): Gain | null {
  const value = holdingValue(holding);
  const cost = holdingCost(holding);
  if (value === null || cost === null) return null;
  return { absolute: value - cost, fraction: cost === 0 ? null : (value - cost) / cost };
}

/** What holdings contribute to net worth, by currency, for sumInBase. */
export function holdingContributions(holdings: Holding[]): { amount: number; currency: string }[] {
  return holdings
    .map((holding) => ({ amount: holdingValue(holding), currency: holding.currency }))
    .filter((entry): entry is { amount: number; currency: string } => entry.amount !== null && entry.amount !== 0);
}

/**
 * The same, as at a past date.
 *
 * A holding with no price on or before that date contributes nothing, which
 * is the point: the app knew nothing about it then, and projecting today's
 * price backwards would invent months of value it never had. Exactly the rule
 * policy valuations follow.
 */
export function holdingContributionsAt(holdings: Holding[], date: string): { amount: number; currency: string }[] {
  return holdings.flatMap((holding) => {
    const price = priceAsAt(holding, date);
    if (price === null) return [];
    const amount = price * holding.quantity;
    return amount === 0 ? [] : [{ amount, currency: holding.currency }];
  });
}
