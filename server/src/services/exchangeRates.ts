/**
 * Exchange rates, so amounts in different currencies can be compared.
 *
 * Frankfurter serves the European Central Bank's daily reference rates with
 * no API key. Those are published once per banking day, which is the right
 * granularity here: this is for reading a balance, not for pricing a trade,
 * and a rate that moves under you between page loads would make the number
 * look unstable for no benefit.
 *
 * Fetched server-side rather than from the browser so one call serves every
 * page and device, and so a rate-limited or unreachable provider degrades in
 * one place.
 */

const ENDPOINT = "https://api.frankfurter.dev/v1/latest";
// ECB publishes once per banking day; six hours keeps it fresh without
// hammering a free service, and survives a serverless instance for its life.
const TTL_MS = 6 * 60 * 60 * 1000;

export interface RatesResponse {
  base: string;
  date: string;
  /** Units of each currency per one unit of base. */
  rates: Record<string, number>;
}

let cache: { at: number; body: RatesResponse } | null = null;
let inFlight: Promise<RatesResponse | null> | null = null;

export async function loadRates(base: string): Promise<RatesResponse | null> {
  if (cache && cache.body.base === base && Date.now() - cache.at < TTL_MS) return cache.body;
  // Collapses concurrent first-loads into one upstream call.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${ENDPOINT}?base=${encodeURIComponent(base)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as RatesResponse;
      if (!data?.rates) return null;
      cache = { at: Date.now(), body: data };
      return data;
    } catch (err) {
      // A missing rate must never take a page down — callers fall back to the
      // unconverted figure and say so.
      console.error("Exchange rate lookup failed:", err);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Converts an amount out of the rates' base currency into `currency`.
 *
 * Returns null rather than the unconverted number when there is no rate, so a
 * caller has to decide what to do about it instead of silently treating one
 * currency's figure as another's.
 */
export function fromBase(amount: number, currency: string, rates: RatesResponse | null): number | null {
  if (!rates) return null;
  if (currency === rates.base) return amount;
  const rate = rates.rates[currency];
  if (!rate) return null;
  return amount * rate;
}
