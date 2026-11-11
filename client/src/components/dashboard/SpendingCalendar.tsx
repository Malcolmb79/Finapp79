import { useMemo } from "react";
import { shade, spendingCalendar } from "../../utils/spendingCalendar.js";
import { formatCurrency } from "../../utils/formatCurrency.js";

/**
 * A month of spending, one square per day.
 *
 * A total says how much and never when. The shape of a month — the quiet
 * stretch, the weekend that cost more than the week around it, the single day
 * that was most of it — is in the ledger already and visible nowhere, because
 * a list is read a row at a time and a pattern lives in no single row.
 *
 * A real calendar rather than a strip of days, because the pattern people are
 * looking for is weekly and only a calendar puts the Saturdays under each
 * other.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export default function SpendingCalendar({
  transactions,
  month,
  currency,
}: {
  transactions: Parameters<typeof spendingCalendar>[0];
  month: string;
  currency: string | null;
}) {
  const calendar = useMemo(() => spendingCalendar(transactions, month), [transactions, month]);
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  if (calendar.total === 0) {
    return <p className="empty-state">Nothing spent this month.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <div>
          <p className="stat-tile__label">Spent this month</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(calendar.total)}</p>
        </div>
        {calendar.busiest && (
          <div>
            <p className="stat-tile__label">Heaviest day</p>
            <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(calendar.busiest.amount)}</p>
            <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>{calendar.busiest.date}</p>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {WEEKDAYS.map((day, index) => (
          <div key={index} style={{ fontSize: "0.62rem", color: "var(--text-muted)", textAlign: "center" }}>
            {day}
          </div>
        ))}

        {calendar.weeks.flat().map((day, index) =>
          day.inMonth ? (
            <div
              key={day.date}
              // Everything the square means, for anyone who cannot see
              // colour or is reading it with a pointer — the shading alone
              // carries the whole message otherwise.
              title={`${day.date}: ${day.amount > 0 ? money(day.amount) : "nothing spent"}`}
              style={{
                aspectRatio: "1",
                borderRadius: 3,
                background:
                  day.amount > 0
                    ? `color-mix(in srgb, var(--seq-450) ${Math.round(shade(day.amount, calendar.peak) * 100)}%, var(--gridline))`
                    : "var(--gridline)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.58rem",
                color: "var(--text-muted)",
              }}
            >
              {Number(day.date.slice(8, 10))}
            </div>
          ) : (
            <div key={`blank-${index}`} />
          )
        )}
      </div>

      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
        Darker is more spent. Scaled so an ordinary day still shows beside a rent payment.
      </p>
    </div>
  );
}
