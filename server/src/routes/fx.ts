import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { loadRates } from "../services/exchangeRates.js";

export const fxRouter = Router();

fxRouter.use(requireAuth);

// Serves the rates the client uses to total balances across currencies. The
// fetching and caching live in services/exchangeRates.ts because the debt
// projections need the same rates, and two caches of the same daily figures
// could disagree with each other.

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
