import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { RecurringPayment } from "../../utils/recurring.js";
import { formatCurrency } from "../../utils/formatCurrency.js";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth.js";

/**
 * What the standing commitments cost, and what each one is.
 *
 * A subscription total answers a question a category breakdown can't: not
 * "what did I spend on entertainment" but "what am I signed up to". The two
 * differ most where it matters — a yearly insurance premium and a monthly
 * streaming bill sit in different categories, in different months, and are
 * the same kind of commitment.
 *
 * Everything is stated per month whatever the billing cadence, because that
 * is the only way a yearly charge and a weekly one can be added together or
 * compared.
 */

const CHART_HEIGHT = 110;
const MONTHS_SHOWN = 12;

const CADENCE_LABEL: Record<RecurringPayment["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/** The last N months, so a month with no charges is still a gap in the bars. */
function recentMonths(count: number): string[] {
  const months: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const month = new Date(cursor);
    month.setMonth(cursor.getMonth() - i);
    months.push(month.toISOString().slice(0, 7));
  }
  return months;
}

function Bars({ data, currency }: { data: { month: string; amount: number }[]; currency: string }) {
  const [ref, width] = useMeasuredWidth(420);
  const max = Math.max(1, ...data.map((d) => d.amount));
  const slot = data.length > 0 ? width / data.length : width;
  const barWidth = Math.max(2, Math.min(26, slot - 8));
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width / 56))));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {/* Drawn at its measured width rather than stretched, so the bars keep
          their shape and nothing inside is distorted by a resize. */}
      <svg width={width} height={CHART_HEIGHT} style={{ display: "block" }}>
        <line x1={0} x2={width} y1={CHART_HEIGHT - 1} y2={CHART_HEIGHT - 1} stroke="var(--gridline)" strokeWidth={1} />
        {data.map((d, i) => {
          const height = (d.amount / max) * (CHART_HEIGHT - 10);
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
              <title>{`${monthLabel(d.month)}: ${formatCurrency(d.amount, currency)}`}</title>
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
              visibility: i % labelStep === 0 || i === data.length - 1 ? "visible" : "hidden",
            }}
          >
            {monthLabel(d.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Subscriptions({ payments, currency }: { payments: RecurringPayment[]; currency: string }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const money = (value: number) => formatCurrency(value, currency);

  if (payments.length === 0) {
    return <p className="empty-state">Nothing charging on a regular rhythm yet.</p>;
  }

  const selected = payments.find((p) => p.key === selectedKey) ?? null;
  const months = recentMonths(MONTHS_SHOWN);

  // What was actually charged in each month, not the smoothed monthly cost —
  // the point of the chart is to show the lumps a yearly renewal puts in one
  // month, which an average would hide.
  const chargesFor = (list: RecurringPayment[]) =>
    months.map((month) => ({
      month,
      amount: list
        .flatMap((p) => p.charges)
        .filter((c) => monthKey(c.date) === month)
        .reduce((sum, c) => sum + c.amount, 0),
    }));

  const monthlyTotal = payments.reduce((sum, p) => sum + p.monthly, 0);

  if (selected) {
    const history = [...selected.charges].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div>
        <button onClick={() => setSelectedKey(null)} style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}>
          <ChevronLeft size={13} /> All subscriptions
        </button>

        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
          <strong style={{ fontSize: "0.95rem" }}>{selected.label}</strong>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {CADENCE_LABEL[selected.cadence]} · {money(selected.amount)} each
          </span>
        </div>
        <p style={{ fontSize: "0.8rem", margin: "0 0 0.6rem" }}>
          <strong>{money(selected.monthly)}</strong> a month · {money(selected.annualised)} a year · {selected.occurrences} charges
          seen
        </p>

        <Bars data={chargesFor([selected])} currency={currency} />

        <table style={{ marginTop: "0.6rem" }}>
          <thead>
            <tr>
              <th>Charged</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {history.map((charge) => (
              <tr key={`${charge.date}-${charge.amount}`}>
                <td>{charge.date}</td>
                <td>{money(charge.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <span className="stat-tile__value" style={{ fontSize: "1.5rem" }}>
          {money(monthlyTotal)}
        </span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          a month across {payments.length} {payments.length === 1 ? "subscription" : "subscriptions"} ·{" "}
          {money(monthlyTotal * 12)} a year
        </span>
      </div>

      <Bars data={chargesFor(payments)} currency={currency} />

      <div style={{ marginTop: "0.7rem" }}>
        {payments.map((p) => (
          // A row is the way in rather than a separate link: the whole line is
          // what you are pointing at when you want to know more about it.
          <button
            key={p.key}
            onClick={() => setSelectedKey(p.key)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.6rem",
              width: "100%",
              background: "transparent",
              border: "none",
              borderTop: "1px solid var(--gridline)",
              padding: "0.45rem 0",
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
              {p.label}
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}> · {CADENCE_LABEL[p.cadence]}</span>
            </span>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
              <strong>{money(p.monthly)}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>/mo</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
