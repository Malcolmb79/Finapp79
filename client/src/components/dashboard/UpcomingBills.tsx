import { CalendarClock } from "lucide-react";
import { formatCurrency } from "../../utils/formatCurrency.js";
import type { UpcomingBill } from "../../utils/forecast.js";

/**
 * What is due before payday.
 *
 * Falls straight out of the recurring detection the subscriptions view
 * already does — the same commitments, read forward instead of backward. The
 * difference is what it is for: a subscriptions list answers "what am I
 * paying for", this answers "what is about to leave".
 *
 * Every line is a prediction from a pattern, not a scheduled instruction
 * anybody told us about, so the dates are approximate by construction and the
 * widget says so once rather than hedging on every row.
 */

function dayLabel(iso: string, from: string): string {
  const days = Math.round((Date.parse(iso) - Date.parse(from)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 13) return `in ${days} days`;
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function UpcomingBills({
  bills,
  currency,
  from,
  horizonDays,
}: {
  bills: UpcomingBill[];
  /** Everything here is converted into this already. */
  currency: string | null;
  from: string;
  horizonDays: number;
}) {
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);

  if (bills.length === 0) {
    return (
      <p className="empty-state">
        Nothing regular is due in the next {horizonDays} days — or there isn’t enough history yet to tell. A bill shows up
        here once it has been charged three times.
      </p>
    );
  }

  return (
    <div>
      <div className="stat-row" style={{ marginBottom: "0.8rem", gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <p className="stat-tile__label">Due in {horizonDays} days</p>
          <p className="stat-tile__value">{money(total)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Payments</p>
          <p className="stat-tile__value">{bills.length}</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.1rem" }}>
        {bills.map((bill) => (
          <div key={bill.key} className="tx-row" style={{ cursor: "default" }}>
            <div className="tx-row__icon">
              <CalendarClock size={15} color="var(--text-muted)" />
            </div>
            <div className="tx-row__info">
              <div className="tx-row__name">{bill.label}</div>
              <div className="tx-row__meta">
                {dayLabel(bill.dueDate, from)} · {bill.cadence}
              </div>
            </div>
            <span className="tx-row__amount">{money(bill.amount)}</span>
          </div>
        ))}
      </div>

      {/* Said once, at the bottom, rather than hedged on every row. */}
      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.6rem 0 0" }}>
        Predicted from what has charged before, so dates are approximate.
      </p>
    </div>
  );
}
