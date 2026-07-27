import { useEffect, useState } from "react";
import { api, type FxRates } from "../api/client.js";

/**
 * Converts an amount into the rates' base currency.
 *
 * Returns null rather than the unconverted number when the rate is unknown:
 * silently treating 1,000 ZAR as 1,000 EUR is how a net worth figure ends up
 * confidently wrong, which is worse than showing nothing.
 */
export function toBase(amount: number, currency: string, rates: FxRates | null): number | null {
  if (!rates) return null;
  if (currency === rates.base) return amount;
  const rate = rates.rates[currency];
  if (!rate) return null;
  // Rates are quoted per unit of base, so dividing converts back to it.
  return amount / rate;
}

/**
 * Totals amounts in mixed currencies. `converted` is the sum of everything
 * that could be converted; `unconvertible` lists currencies with no rate, so
 * a total is never presented as complete when part of it is missing.
 */
export function sumInBase(
  entries: { amount: number; currency: string }[],
  rates: FxRates | null
): { converted: number; unconvertible: string[] } {
  let converted = 0;
  const unconvertible = new Set<string>();
  for (const entry of entries) {
    const value = toBase(entry.amount, entry.currency, rates);
    if (value == null) unconvertible.add(entry.currency);
    else converted += value;
  }
  return { converted, unconvertible: [...unconvertible] };
}

// Module-scoped so every widget on a page shares one fetch rather than each
// asking for rates on mount.
let cached: FxRates | null = null;
let inFlight: Promise<FxRates | null> | null = null;

export function useFxRates(base = "EUR"): FxRates | null {
  const [rates, setRates] = useState<FxRates | null>(cached);

  useEffect(() => {
    if (cached) return;
    inFlight ??= api.fxRates(base).catch(() => null);
    let cancelled = false;
    inFlight.then((result) => {
      cached = result;
      if (!cancelled) setRates(result);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  return rates;
}
