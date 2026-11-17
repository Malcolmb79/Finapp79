import { useEffect, useState } from "react";
import { api, type Account, type Budget, type Transaction } from "../api/client.js";
import { isLiability, accountBalance, accountTxSums, visibleAccounts, visibleTransactions } from "./accountBalance.js";
import { deriveAlerts, undismissed, type Alert, type AlertDismissal } from "./alerts.js";
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

export function useAlerts(refreshKey: unknown): {
  alerts: Alert[];
  all: Alert[];
  dismiss: (alerts: Alert[]) => Promise<void>;
  unread: () => Promise<void>;
} {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissals, setDismissals] = useState<AlertDismissal[]>([]);
  const [readKey, setReadKey] = useState(0);
  const rates = useFxRates("EUR");

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.listAccounts(), api.listTransactions(), api.listBudgets(), api.listAlertDismissals()])
      .then(([allAccounts, allTransactions, budgets, read]: [Account[], Transaction[], Budget[], AlertDismissal[]]) => {
        if (cancelled) return;
        setDismissals(read);

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
        const derived = deriveAlerts({ budgets, accounts, forecast, bills, money }, from);
        setAlerts(derived);

        /**
         * Forget what was read about an alert that no longer exists.
         *
         * A condition that resolves and comes back next month is news again,
         * not something already marked read — and without this the table
         * keeps a row for every alert the household has ever had. Fired only
         * when there is actually something to forget, so the ordinary case is
         * three requests as before.
         */
        const live = new Set(derived.map((alert) => alert.id));
        if (read.some((d) => !live.has(d.alert_id))) {
          api.pruneAlertDismissals([...live]).catch(() => {});
          setDismissals(read.filter((d) => live.has(d.alert_id)));
        }
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
  }, [rates, refreshKey, readKey]);

  /**
   * Marks them read, and hides them straight away.
   *
   * The local state moves before the request settles because the gesture is
   * "clear this" and a badge that waits for a round trip reads as a button
   * that did not work. `readKey` then re-runs the fetch, so what is on screen
   * ends up being what the server holds either way.
   */
  const dismiss = async (toRead: Alert[]) => {
    if (toRead.length === 0) return;
    setDismissals((current) => [
      ...current.filter((d) => !toRead.some((a) => a.id === d.alert_id)),
      ...toRead.map((a) => ({ alert_id: a.id, severity: a.severity })),
    ]);
    try {
      await api.dismissAlerts(toRead.map((a) => ({ alert_id: a.id, severity: a.severity })));
    } finally {
      setReadKey((n) => n + 1);
    }
  };

  /** Puts everything back, for when something was cleared too quickly. */
  const unread = async () => {
    setDismissals([]);
    try {
      await api.pruneAlertDismissals([]);
    } finally {
      setReadKey((n) => n + 1);
    }
  };

  // `all` is everything derived, read or not — the panel offers a way to see
  // what it is holding back, since an alert that vanished with no trace of
  // where it went is its own kind of wrong.
  return { alerts: undismissed(alerts, dismissals), all: alerts, dismiss, unread };
}
