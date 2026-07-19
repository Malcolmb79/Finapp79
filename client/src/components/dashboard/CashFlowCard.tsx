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
export default function CashFlowCard({ income, expenses, months }: { income: number; expenses: number; months: MonthFlow[] }) {
  const saved = income - expenses;
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));

  const width = 560;
  const slot = months.length > 0 ? width / months.length : width;
  const barWidth = Math.min(BAR_MAX_THICKNESS, (slot - 16) / 2);

  return (
    <div>
      <div className="stat-row" style={{ marginBottom: "1.25rem" }}>
        <StatTile label="Income" value={income.toFixed(2)} />
        <StatTile label="Expenses" value={expenses.toFixed(2)} />
        <div>
          <p className="stat-tile__label">Saved</p>
          <p className={`stat-tile__value${saved >= 0 ? " stat-tile__value--good" : ""}`}>{saved.toFixed(2)}</p>
        </div>
      </div>

      {months.length === 0 ? (
        <p className="empty-state">Nothing to show yet.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} width="100%" height={CHART_HEIGHT} preserveAspectRatio="none">
          <line x1="0" y1={CHART_HEIGHT - 16} x2={width} y2={CHART_HEIGHT - 16} stroke="var(--gridline)" strokeWidth="1" />
          {months.map((m, i) => {
            const slotX = i * slot;
            const incomeH = (m.income / max) * (CHART_HEIGHT - 32);
            const expenseH = (m.expenses / max) * (CHART_HEIGHT - 32);
            const baseline = CHART_HEIGHT - 16;
            const x1 = slotX + slot / 2 - barWidth - 2;
            const x2 = slotX + slot / 2 + 2;
            return (
              <g key={m.label}>
                <rect x={x1} y={baseline - incomeH} width={barWidth} height={incomeH} rx="4" fill="var(--seq-450)" />
                <rect x={x2} y={baseline - expenseH} width={barWidth} height={expenseH} rx="4" fill="var(--text-muted)" opacity="0.55" />
                <text x={slotX + slot / 2} y={CHART_HEIGHT} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
