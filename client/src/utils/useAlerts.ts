import { useEffect, useState } from "react";
import { api, type Account, type Budget, type Transaction } from "../api/client.js";
import { isLiability, accountBalance, accountTxSums, visibleAccounts, visibleTransactions } from "./accountBalance.js";
import { deriveAlerts, type Alert } from "./alerts.js";
import { forecastBalance, addDaysIso, today, upcomingBills } from "./forecast.js";
import { formatCurrency } from "./formatCurrency.js";
import { inBase, sumInBase, useFxRates } from "./fx.js";

/**
 * Everything the bell needs to say what wants attention.
 *
 * Fetched here rather than threaded down from a page, because the header
 * outlives every page and an alert that only appeared on the dashboard would
 * be an alert you have to go looking for — which is the opposite of the
 * point. The requests are the same three the dashboard makes, at the scale of
 * one household's finances.
 *
 * Deliberately ignores the account scope. The scope is a lens someone is
 * holding for a moment; a budget going over is true whether or not they are
 * currently looking at the account it happened on.
 */

/** Matches the dashboard's horizon, so the two never disagree about a date. */
const FORECAST_DAYS = 60;

export function useAlerts(refreshKey: unknown): Alert[] {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const rates = useFxRates("EUR");

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.listAccounts(), api.listTransactions(), api.listBudgets()])
      .then(([allAccounts, allTransactions, budgets]: [Account[], Transaction[], Budget[]]) => {
        if (cancelled) return;

        const accounts = visibleAccounts(allAccounts);
        const transactions = visibleTransactions(allTransactions, allAccounts);
        const byAccount = accountTxSums(accounts, transactions);

        // Spendable accounts only, for the same reason the dashboard's
        // forecast uses them: a loan balance is real debt but it is not money
        // leaving the current account before payday.
        const spendable = accounts
          .filter((a) => !isLiability(a))
          .map((a) => ({ amount: accountBalance(a, byAccount.get(a.id) ?? 0), currency: a.currency }));
        const { converted: opening } = sumInBase(spendable, rates);

        const { items: converted } = inBase(transactions, rates);
        const from = today();
        const forecast = forecastBalance(converted, opening, { from, days: FORECAST_DAYS });
        const bills = upcomingBills(converted, { from, until: addDaysIso(from, FORECAST_DAYS) });

        const money = (value: number) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2));
        setAlerts(deriveAlerts({ budgets, accounts, forecast, bills, money }, from));
      })
      // An alert list that cannot be built is simply empty. Failing loudly in
      // the header would put an error where the app's own warnings go, which
      // is the one place a spurious red mark does the most damage.
      .catch(() => {
        if (!cancelled) setAlerts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [rates, refreshKey]);

  return alerts;
}
