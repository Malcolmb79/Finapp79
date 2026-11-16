import { useState } from "react";
import type { Category, Transaction } from "../api/client.js";
import MagnitudeBarList from "./dashboard/MagnitudeBarList.js";
import { categoryBreakdown } from "../utils/categoryBreakdown.js";
import { dateRangeLabel, withinRange } from "../utils/dateRange.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";
import { useDateRange } from "../contexts/ViewFilterContext.js";
import { useMeasuredWidth } from "../utils/useMeasuredWidth.js";

/**
 * One category, opened up.
 *
 * A category total says how much and stops where the useful question starts.
 * €612 of groceries is either four big shops or forty small ones, either
 * steady or up a third since August, and the total reads the same in every
 * case. So this shows the three shapes the spending can have — by month, by
 * who was paid, and how big a typical payment is — because each one is
 * invisible inside the others.
 *
 * It obeys the period in the header rather than carrying a picker of its own.
 * Two date controls on one screen is a way to be confidently wrong about
 * which one a figure obeyed, and the period is named on the card for the same
 * reason every report carries one: a total without a period is not a fact.
 */

const CHART_HEIGHT = 96;

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function MonthBars({ data, currency }: { data: { month: string; total: number; count: number }[]; currency: string }) {
  const [ref, width] = useMeasuredWidth(320);
  const max = Math.max(1, ...data.map((d) => d.total));
  const slot = data.length > 0 ? width / data.length : width;
  const barWidth = Math.max(2, Math.min(28, slot - 8));
  const step = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width / 56))));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={CHART_HEIGHT} style={{ display: "block" }}>
        <line x1={0} x2={width} y1={CHART_HEIGHT - 1} y2={CHART_HEIGHT - 1} stroke="var(--gridline)" strokeWidth={1} />
        {data.map((d, i) => {
          const height = (d.total / max) * (CHART_HEIGHT - 10);
          return (
            <rect
              key={d.month}
              x={i * slot + (slot - barWidth) / 2}
              y={CHART_HEIGHT - 1 - height}
              width={barWidth}
              height={height}
              rx={3}
              fill="var(--seq-450)"
            >
              <title>{`${monthLabel(d.month)}: ${formatCurrency(d.total, currency)} across ${d.count} ${
                d.count === 1 ? "payment" : "payments"
              }`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
        {data.map((d, i) => (
          <span
            key={d.month}
            style={{
              width: slot,
              textAlign: "center",
              overflow: "hidden",
              whiteSpace: "nowrap",
              visibility: i % step === 0 || i === data.length - 1 ? "visible" : "hidden",
            }}
          >
            {monthLabel(d.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function CategoryBreakdown({
  transactions,
  categories,
  categoryId,
  onSelect,
}: {
  transactions: Transaction[];
  categories: Category[];
  /** Driven from the Categories card, so clicking a name there opens it here. */
  categoryId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [showAllPayees, setShowAllPayees] = useState(false);
  const { range } = useDateRange();
  const rates = useFxRates("EUR");

  // Converted before anything is totalled, for the same reason every other
  // combined figure in this app is: adding ZAR to EUR gives a number in no
  // currency. What could not be converted is named rather than dropped
  // quietly, since a total missing a currency looks exactly like a small one.
  const { items, dropped } = inBase(withinRange(transactions, range), rates);
  const currency = rates?.base ?? "EUR";
  const money = (value: number) => formatCurrency(value, currency);

  const picker = (
    <select
      value={categoryId ?? ""}
      onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
      aria-label="Category to break down"
      style={{ fontSize: "0.8rem", maxWidth: "100%" }}
    >
      <option value="">Pick a category…</option>
      {[...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
    </select>
  );

  if (categoryId == null) {
    return (
      <div>
        {picker}
        <p className="empty-state" style={{ marginTop: "0.6rem" }}>
          Pick a category — or click one in the Categories card — to see what it is made of.
        </p>
      </div>
    );
  }

  const category = categories.find((c) => c.id === categoryId);
  const breakdown = categoryBreakdown(items, categoryId);
  const payees = showAllPayees ? breakdown.payees : breakdown.payees.slice(0, 8);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {picker}
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{dateRangeLabel(range)}</span>
      </div>

      {breakdown.count === 0 ? (
        <p className="empty-state">
          Nothing filed under {category?.name ?? "that category"} in this period. The period is the one in the header —
          try widening it.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.1rem" }}>
            <span className="stat-tile__value" style={{ fontSize: "1.5rem" }}>
              {money(breakdown.total)}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              across {breakdown.count} {breakdown.count === 1 ? "payment" : "payments"} ·{" "}
              {money(breakdown.monthlyAverage)} in a month it is used
            </span>
          </div>

          {/* The middle payment beside the biggest, because that pair is what
              says which shape the category has. Forty small shops and four
              big ones can reach the same total and want opposite answers. */}
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
            Typical payment {money(breakdown.typical)} · largest {money(breakdown.largest)}
            {breakdown.refundCount > 0 && (
              <>
                {" · "}
                <span style={{ color: "var(--good)" }}>
                  {money(breakdown.refunds)} back in {breakdown.refundCount}{" "}
                  {breakdown.refundCount === 1 ? "refund" : "refunds"}
                </span>
              </>
            )}
          </p>

          <MonthBars data={breakdown.months} currency={currency} />

          <div style={{ marginTop: "0.8rem" }}>
            <p className="stat-tile__label" style={{ marginBottom: "0.3rem" }}>
              Who was paid
            </p>
            <MagnitudeBarList
              data={payees.map((p) => ({ label: `${p.label}${p.count > 1 ? ` ×${p.count}` : ""}`, value: p.total }))}
              currency={currency}
            />
            {breakdown.payees.length > payees.length && (
              <button
                type="button"
                onClick={() => setShowAllPayees(true)}
                style={{ fontSize: "0.72rem", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", padding: "0.3rem 0 0" }}
              >
                Show all {breakdown.payees.length}
              </button>
            )}
          </div>

          {/* A refund is not negative spending, so it is never netted off the
              total above. Both figures are true and only one of them is the
              answer to "what did this cost". */}
          {dropped.length > 0 && (
            <p style={{ fontSize: "0.7rem", color: "var(--warning)", margin: "0.5rem 0 0" }}>
              Left out: {dropped.join(", ")} — no exchange rate for {dropped.length === 1 ? "it" : "them"} just now.
            </p>
          )}
        </>
      )}
    </div>
  );
}
