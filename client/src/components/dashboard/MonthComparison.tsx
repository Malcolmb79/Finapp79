import { useMemo } from "react";
import { compareMonths } from "../../utils/monthComparison.js";
import { formatCurrency } from "../../utils/formatCurrency.js";

/**
 * This month against the same stretch of last, by category.
 *
 * The comparison people make unprompted — "am I spending more than usual?" —
 * which a total for the month cannot answer, because a total is only high or
 * low relative to something.
 *
 * The bars are drawn to the larger of the two sides so they are comparable
 * across rows, and each row says the two figures as well as drawing them: a
 * bar answers "which moved most" and only the numbers answer "by how much".
 */

const ROWS = 7;

export default function MonthComparison({
  transactions,
  categoryName,
  currency,
  today,
}: {
  transactions: Parameters<typeof compareMonths>[0];
  categoryName: (id: number | null) => string | null;
  currency: string | null;
  today: string;
}) {
  const comparison = useMemo(() => compareMonths(transactions, categoryName, today), [transactions, categoryName, today]);
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  if (comparison.rows.length === 0) {
    return <p className="empty-state">Nothing to compare yet.</p>;
  }

  const rows = comparison.rows.slice(0, ROWS);
  const widest = Math.max(1, ...rows.map((row) => Math.max(row.now, row.before)));
  const up = comparison.delta > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <div>
          <p className="stat-tile__label">So far this month</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(comparison.now)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Same stretch last month</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(comparison.before)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Difference</p>
          {/* Spending less is the good direction, which is the opposite of
              every other figure on the dashboard — so the colour follows the
              meaning rather than the sign. */}
          <p
            className={`stat-tile__value${up ? "" : " stat-tile__value--good"}`}
            style={{ fontSize: "1.05rem", color: up ? "var(--warning)" : undefined }}
          >
            {up ? "+" : "−"}
            {money(Math.abs(comparison.delta))}
          </p>
        </div>
      </div>

      {/* Said rather than implied. Eleven days against thirty would show every
          category falling every month until the last day, and somebody
          reading that would conclude they had spent less when they had not. */}
      {comparison.partial && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
          First {comparison.days} days of each month, so the two sides cover the same stretch.
        </p>
      )}

      <div style={{ display: "grid", gap: "0.45rem", overflowY: "auto", minHeight: 0 }}>
        {rows.map((row) => {
          const rose = row.delta > 0;
          return (
            <div key={row.key}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", gap: "0.5rem" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                <span style={{ color: rose ? "var(--warning)" : "var(--good)", whiteSpace: "nowrap" }}>
                  {rose ? "+" : "−"}
                  {money(Math.abs(row.delta))}
                </span>
              </div>
              {/* Two bars, this month over last, drawn to the same scale. */}
              <div style={{ display: "grid", gap: 2, marginTop: 2 }}>
                <div style={{ height: 6, background: "var(--gridline)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(row.now / widest) * 100}%`, height: "100%", background: "var(--seq-450)" }} />
                </div>
                <div style={{ height: 6, background: "var(--gridline)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(row.before / widest) * 100}%`, height: "100%", background: "var(--text-muted)", opacity: 0.55 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {comparison.rows.length > ROWS && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
          {comparison.rows.length - ROWS} smaller {comparison.rows.length - ROWS === 1 ? "change" : "changes"} not shown.
        </p>
      )}
    </div>
  );
}
