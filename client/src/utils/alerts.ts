import type { Account, Budget } from "../api/client.js";
import type { Forecast, UpcomingBill } from "./forecast.js";

/**
 * The things worth interrupting someone about.
 *
 * This is what turns the app from one you visit into one that tells you, and
 * the whole design question is restraint: an alert that fires when nothing is
 * wrong trains you to ignore the one that fires when something is. So every
 * alert here answers a question with a real answer and a thing to do about
 * it, and anything that would fire most weeks is left out.
 *
 * What is deliberately absent is "unusual spend", which the market generally
 * ships. The honest versions of it need a merchant's own history to compare
 * against, and `detectRecurring` only groups charges within 20% of each other
 * — so a genuine price rise breaks the group rather than showing up inside it,
 * and what is left to flag is "you spent more than usual", which is true most
 * months and means nothing.
 */

export type AlertKind = "budget" | "forecast" | "bill" | "sync";
export type AlertSeverity = "critical" | "warning";

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Where to go to do something about it. */
  href: string;
}

/** A budget this far through is worth saying something about. */
const BUDGET_WARN_AT = 0.9;

/** How far ahead a bill is close enough to matter. */
const BILL_SOON_DAYS = 7;

function daysUntil(iso: string, from: string): number {
  return Math.round((Date.parse(iso) - Date.parse(from)) / 86_400_000);
}

function dayPhrase(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function deriveAlerts(
  {
    budgets,
    accounts,
    forecast,
    bills,
    money,
  }: {
    budgets: Budget[];
    accounts: Account[];
    forecast: Forecast | null;
    bills: UpcomingBill[];
    /** Formats a figure in whatever currency the caller is working in. */
    money: (value: number) => string;
  },
  from: string
): Alert[] {
  const alerts: Alert[] = [];

  // Over the limit is a fact; near it is a warning worth having while there is
  // still a month left to act in. Both link to the budget rather than just
  // stating the number.
  for (const budget of budgets) {
    if (budget.monthly_limit <= 0) continue;
    const ratio = budget.spent / budget.monthly_limit;
    if (ratio >= 1) {
      alerts.push({
        id: `budget:${budget.id}`,
        kind: "budget",
        severity: "critical",
        title: `${budget.category_name} is over budget`,
        detail: `${money(budget.spent)} of ${money(budget.monthly_limit)} this month`,
        href: `/transactions?category=${budget.category_id}&from=${from.slice(0, 7)}-01`,
      });
    } else if (ratio >= BUDGET_WARN_AT) {
      alerts.push({
        id: `budget:${budget.id}`,
        kind: "budget",
        severity: "warning",
        title: `${budget.category_name} is nearly spent`,
        detail: `${money(budget.spent)} of ${money(budget.monthly_limit)} — ${money(budget.monthly_limit - budget.spent)} left`,
        href: `/transactions?category=${budget.category_id}&from=${from.slice(0, 7)}-01`,
      });
    }
  }

  // The one genuinely forward-looking alert, and the reason the forecast was
  // worth building: being told on the 2nd that the 14th is short is actionable
  // in a way that being told on the 14th is not.
  if (forecast?.low && forecast.low.balance < 0) {
    const days = daysUntil(forecast.low.date, from);
    alerts.push({
      id: "forecast:low",
      kind: "forecast",
      severity: "critical",
      title: "Balance goes negative",
      detail: `Down to ${money(forecast.low.balance)} ${dayPhrase(days)}, on what repeats`,
      href: "/",
    });
  }

  // Only the near ones. A list of everything due in two months is the Due
  // soon widget's job, not an alert's.
  for (const bill of bills) {
    const days = daysUntil(bill.dueDate, from);
    if (days > BILL_SOON_DAYS) continue;
    alerts.push({
      id: `bill:${bill.key}`,
      kind: "bill",
      severity: "warning",
      title: `${bill.label} due ${dayPhrase(days)}`,
      detail: money(bill.amount),
      href: "/",
    });
  }

  // A sync that stopped working is the quietest failure in the app: the
  // account simply stops changing, which looks exactly like an account with
  // nothing happening on it.
  for (const account of accounts) {
    if (!account.last_sync_error) continue;
    alerts.push({
      id: `sync:${account.id}`,
      kind: "sync",
      severity: "critical",
      title: `${account.name} isn’t syncing`,
      detail: account.last_sync_error,
      href: "/accounts",
    });
  }

  // Critical first, then by kind, so the order is stable between renders
  // rather than following whichever list happened to be built first.
  const order: Record<AlertKind, number> = { forecast: 0, sync: 1, budget: 2, bill: 3 };
  return alerts.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title)
  );
}
