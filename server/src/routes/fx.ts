import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";

export const fxRouter = Router();

fxRouter.use(requireAuth);

/**
 * Exchange rates, so balances in different currencies can be totalled.
 *
 * Frankfurter serves the European Central Bank's daily reference rates with
 * no API key. Those are published once per banking day, which is the right
 * granularity here: this is for reading a net worth figure, not for pricing a
 * trade, and a rate that moves under you between page loads would make the
 * number look unstable for no benefit.
 *
 * Fetched server-side rather than from the browser so one call serves every
 * page and device, and so a rate-limited or unreachable provider degrades in
 * one place.
 */

const ENDPOINT = "https://api.frankfurter.dev/v1/latest";
// ECB publishes once per banking day; six hours keeps it fresh without
// hammering a free service, and survives a serverless instance for its life.
const TTL_MS = 6 * 60 * 60 * 1000;

interface RatesResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

let cache: { at: number; body: RatesResponse } | null = null;
let inFlight: Promise<RatesResponse | null> | null = null;

async function loadRates(base: string): Promise<RatesResponse | null> {
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
      // A missing rate must never take a dashboard down — the caller falls
      // back to showing per-currency totals instead of a combined one.
      console.error("Exchange rate lookup failed:", err);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

fxRouter.get("/", async (req, res) => {
  const base = typeof req.query.base === "string" && /^[A-Za-z]{3}$/.test(req.query.base) ? req.query.base.toUpperCase() : "EUR";
  const rates = await loadRates(base);
  if (!rates) {
    res.status(503).json({ error: "exchange rates are unavailable right now" });
    return;
  }
  // The base itself is 1 by definition and absent from the provider's map;
  // including it means callers don't need to special-case it.
  res.json({ base: rates.base, date: rates.date, rates: { ...rates.rates, [rates.base]: 1 } });
});
