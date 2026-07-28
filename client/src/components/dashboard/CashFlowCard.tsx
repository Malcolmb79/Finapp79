import { formatCurrency } from "../../utils/formatCurrency.js";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth.js";
import StatTile from "./StatTile.js";

export interface MonthFlow {
  label: string;
  income: number;
  expenses: number;
}

const BAR_MAX_THICKNESS = 20;
const CHART_HEIGHT = 130;

/**
 * Grouped bar, two series (income vs expenses) -> categorical treatment,
 * but income/expense is really a signed pair rather than free-form
 * identity, so a saturated accent (income) against a de-emphasized neutral
 * (expenses) reads clearer than two same-family hues here.
 */
export default function CashFlowCard({
  income,
  expenses,
  months,
  currency,
  mode = "chart",
}: {
  income: number;
  expenses: number;
  months: MonthFlow[];
  /** Every figure here combines accounts, so it is already converted into this. */
  currency: string | null;
  mode?: "chart" | "number";
}) {
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));
  const saved = income - expenses;
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));

  const [plotRef, plotWidth] = useMeasuredWidth(560);
  const slot = months.length > 0 ? plotWidth / months.length : plotWidth;
  const barWidth = Math.max(2, Math.min(BAR_MAX_THICKNESS, (slot - 16) / 2));
  // Roughly one label per 56px, always keeping the last, so a year of months
  // on a narrow card thins out instead of overlapping.
  const labelStep = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(plotWidth / 56))));

  return (
    <div>
      <div className="stat-row" style={{ marginBottom: "1.25rem" }}>
        <StatTile label="Income" value={money(income)} />
        <StatTile label="Expenses" value={money(expenses)} />
        <div>
          <p className="stat-tile__label">Saved</p>
          <p className={`stat-tile__value${saved >= 0 ? " stat-tile__value--good" : ""}`}>{money(saved)}</p>
        </div>
      </div>

      {mode !== "chart" ? null : months.length === 0 ? (
        <p className="empty-state">Nothing to show yet.</p>
      ) : (
        <div ref={plotRef} style={{ width: "100%" }}>
          {/* Drawn at the width it actually has. With preserveAspectRatio
              ="none" the viewBox stretches to fill, and everything in it
              stretches with it — the month labels were being pulled wide as
              the widget was resized, because they were text inside a
              distorted coordinate system. */}
          <svg width={plotWidth} height={CHART_HEIGHT} style={{ display: "block" }}>
            <line x1="0" y1={CHART_HEIGHT - 4} x2={plotWidth} y2={CHART_HEIGHT - 4} stroke="var(--gridline)" strokeWidth="1" />
            {months.map((m, i) => {
              const slotX = i * slot;
              const incomeH = (m.income / max) * (CHART_HEIGHT - 20);
              const expenseH = (m.expenses / max) * (CHART_HEIGHT - 20);
              const baseline = CHART_HEIGHT - 4;
              const x1 = slotX + slot / 2 - barWidth - 2;
              const x2 = slotX + slot / 2 + 2;
              return (
                <g key={m.label}>
                  <rect x={x1} y={baseline - incomeH} width={barWidth} height={incomeH} rx="4" fill="var(--seq-450)" />
                  <rect x={x2} y={baseline - expenseH} width={barWidth} height={expenseH} rx="4" fill="var(--text-muted)" opacity="0.55" />
                  <title>{`${m.label}: ${money(m.income)} in, ${money(m.expenses)} out`}</title>
                </g>
              );
            })}
          </svg>

          {/* Labels as HTML beneath the plot rather than text inside it, so
              they stay the size they are set at whatever the widget does.
              Thinned when there are more months than there is room for. */}
          <div style={{ display: "flex", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            {months.map((m, i) => (
              <span
                key={m.label}
                style={{
                  width: slot,
                  textAlign: "center",
                  visibility: i % labelStep === 0 || i === months.length - 1 ? "visible" : "hidden",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
