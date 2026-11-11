import { Link } from "react-router-dom";
import { formatCurrency } from "../../utils/formatCurrency.js";
import { useMeasuredSize } from "../../utils/useMeasuredSize.js";

/**
 * The transaction list, windowed to one calendar month.
 *
 * The last day is computed rather than assumed — day 0 of the next month is
 * the previous month's last day, which gets February and the 30-day months
 * right without a table of lengths.
 */
function monthHref(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return `/transactions?from=${month}-01&to=${month}-${String(lastDay).padStart(2, "0")}`;
}

export interface MonthFlow {
  label: string;
  income: number;
  expenses: number;
  /**
   * Where this bar's figures came from, as `YYYY-MM`.
   *
   * Set so the bar can be opened: a month's income and spending are a question
   * with an answer underneath them, and the answer is that month's
   * transactions.
   */
  month?: string;
}

const BAR_MAX_THICKNESS = 20;
const CHART_HEIGHT = 130;
// Room under the plot for the month labels, and a floor below which the bars
// stop saying anything.
const LABEL_ROW = 20;
const MIN_CHART_HEIGHT = 60;

/**
 * Grouped bar, two series (income vs expenses) -> categorical treatment,
 * but income/expense is really a signed pair rather than free-form
 * identity, so a saturated accent (income) against a de-emphasized neutral
 * (expenses) reads clearer than two same-family hues here.
 */
/**
 * The two fills, named once.
 *
 * The swatch in the key and the bar it describes have to be the same
 * colour, and the way that stops being true is someone changing one of
 * them. Naming them here makes the key wrong only if the chart is wrong
 * too, which is the kind of wrong somebody notices.
 */
const INCOME_FILL = "var(--seq-450)";
const EXPENSE_FILL = "var(--text-muted)";
const EXPENSE_OPACITY = 0.55;

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

  // Height as well as width: the chart has to leave room for the labels
  // beneath it, and a fixed height inside a resizable card either crops them
  // or leaves a gap. They disappeared entirely when the bars grew into the
  // space they needed.
  const [plotRef, plot] = useMeasuredSize(560, CHART_HEIGHT + LABEL_ROW);
  const plotWidth = plot.width;
  const chartHeight = Math.max(MIN_CHART_HEIGHT, plot.height - LABEL_ROW);
  const slot = months.length > 0 ? plotWidth / months.length : plotWidth;
  const barWidth = Math.max(2, Math.min(BAR_MAX_THICKNESS, (slot - 16) / 2));
  // Roughly one label per 56px, always keeping the last, so a year of months
  // on a narrow card thins out instead of overlapping.
  const labelStep = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(plotWidth / 56))));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* The totals double as the chart's key.
          Two series drawn in two colours and nothing anywhere saying which is
          which: the only way to tell was to reason from the heights, and when
          income and expenses are close — which is the interesting case — even
          that doesn't work. A swatch beside each total costs no space and
          puts the answer where the eye already is, rather than in a legend
          off to one side. */}
      <div className="stat-row" style={{ marginBottom: "1rem" }}>
        <div>
          <p className="stat-tile__label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: INCOME_FILL, flexShrink: 0 }} aria-hidden />
            Income
          </p>
          <p className="stat-tile__value">{money(income)}</p>
        </div>
        <div>
          <p className="stat-tile__label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: EXPENSE_FILL, opacity: EXPENSE_OPACITY, flexShrink: 0 }}
              aria-hidden
            />
            Expenses
          </p>
          <p className="stat-tile__value">{money(expenses)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Saved</p>
          <p className={`stat-tile__value${saved >= 0 ? " stat-tile__value--good" : ""}`}>{money(saved)}</p>
        </div>
      </div>

      {mode !== "chart" ? null : months.length === 0 ? (
        <p className="empty-state">Nothing to show yet.</p>
      ) : (
        <div ref={plotRef} style={{ width: "100%", flex: 1, minHeight: MIN_CHART_HEIGHT + LABEL_ROW, overflow: "hidden" }}>
          {/* Drawn at the width it actually has. With preserveAspectRatio
              ="none" the viewBox stretches to fill, and everything in it
              stretches with it — the month labels were being pulled wide as
              the widget was resized, because they were text inside a
              distorted coordinate system. */}
          <svg width={plotWidth} height={chartHeight} style={{ display: "block" }}>
            <line x1="0" y1={chartHeight - 1} x2={plotWidth} y2={chartHeight - 1} stroke="var(--gridline)" strokeWidth="1" />
            {months.map((m, i) => {
              const slotX = i * slot;
              const incomeH = (m.income / max) * (chartHeight - 8);
              const expenseH = (m.expenses / max) * (chartHeight - 8);
              const baseline = chartHeight - 1;
              const x1 = slotX + slot / 2 - barWidth - 2;
              const x2 = slotX + slot / 2 + 2;
              const bars = (
                <>
                  <rect x={x1} y={baseline - incomeH} width={barWidth} height={incomeH} rx="4" fill={INCOME_FILL} />
                  <rect x={x2} y={baseline - expenseH} width={barWidth} height={expenseH} rx="4" fill={EXPENSE_FILL} opacity={EXPENSE_OPACITY} />
                  {/* A transparent rect over the whole slot, so the month can
                      be hit anywhere above its label rather than only on two
                      thin bars — a month that barely spent anything has almost
                      no bar to aim at. */}
                  <rect x={slotX} y={0} width={slot} height={chartHeight} fill="transparent" />
                  <title>
                    {`${m.label}: ${money(m.income)} in, ${money(m.expenses)} out`}
                    {m.month ? " — open this month" : ""}
                  </title>
                </>
              );
              return m.month ? (
                <Link key={m.label} to={monthHref(m.month)} style={{ cursor: "pointer" }}>
                  {bars}
                </Link>
              ) : (
                <g key={m.label}>{bars}</g>
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
