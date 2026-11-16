import { useState } from "react";
import type { DayPoint } from "../../utils/dashboardSummary.js";

/**
 * What has gone out, day by day, across the month.
 *
 * Two readings of the same days, because they answer different questions and
 * a template that offers only the first is showing the less useful one.
 *
 * **Each day** is the shape of a month: three or four heavy days and a lot of
 * nothing. It is where a surprise shows up.
 *
 * **Running total** is the one that tells you whether this month is going
 * like the last one — a line that is steeper than usual by the tenth has
 * already told you something no daily bar can.
 *
 * Quiet days are drawn as zero rather than skipped. A line through only the
 * days with spending rises smoothly and hides the shape entirely.
 */

export default function ExpenseTrend({
  points,
  money,
  /** Where the same month ended last time, if there is one, for a line to beat. */
  lastMonth,
}: {
  points: DayPoint[];
  money: (value: number) => string;
  lastMonth?: DayPoint[];
}) {
  const [mode, setMode] = useState<"daily" | "running">("daily");

  if (points.length === 0) {
    return <p className="empty-state">Nothing has gone out this month yet.</p>;
  }

  const width = 560;
  const height = 130;
  const values = points.map((p) => (mode === "daily" ? p.amount : p.cumulative));
  const comparison = mode === "running" && lastMonth ? lastMonth.map((p) => p.cumulative) : null;
  const ceiling = Math.max(1, ...values, ...(comparison ?? []));
  const step = width / Math.max(1, points.length - 1);

  const x = (i: number) => (points.length === 1 ? width / 2 : i * step);
  const y = (value: number) => height - (value / ceiling) * height;

  const line = (series: number[]) =>
    series.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  const biggest = points.reduce((worst, point) => (point.amount > worst.amount ? point : worst), points[0]);
  const total = points[points.length - 1].cumulative;

  return (
    <>
      <div className="trend-head">
        <div>
          <p className="stat-tile__label">{mode === "daily" ? "Biggest day" : "Out so far"}</p>
          <p className="stat-tile__value" style={{ fontSize: "1.2rem" }}>
            {money(mode === "daily" ? biggest.amount : total)}
          </p>
          <p className="trend-head__detail">
            {mode === "daily"
              ? biggest.amount > 0
                ? new Date(`${biggest.date}T00:00:00Z`).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })
                : "nothing yet"
              : `over ${points.length} day${points.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.2rem" }}>
          {(["daily", "running"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              style={{
                fontSize: "0.7rem",
                padding: "0.15rem 0.4rem",
                fontWeight: mode === option ? 600 : 400,
                opacity: mode === option ? 1 : 0.6,
              }}
            >
              {option === "daily" ? "Each day" : "Running total"}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height + 16}`} width="100%" height={height + 16} role="img" aria-label="Spending through the month">
        {mode === "daily" ? (
          points.map((point, i) => {
            const barHeight = Math.max(point.amount > 0 ? 1 : 0, (point.amount / ceiling) * height);
            return (
              <rect
                key={point.date}
                x={x(i) - Math.max(1, step * 0.35)}
                y={height - barHeight}
                width={Math.max(2, step * 0.7)}
                height={barHeight}
                rx={1}
                fill="var(--seq-450)"
              >
                <title>{`${point.date}: ${money(point.amount)}`}</title>
              </rect>
            );
          })
        ) : (
          <>
            {/* Last month first, so this month draws over it rather than
                under — the line somebody is reading should never be the one
                behind. */}
            {comparison && <path d={line(comparison)} fill="none" stroke="var(--baseline)" strokeWidth={1.5} strokeDasharray="4 3" />}
            <path d={line(values)} fill="none" stroke="var(--accent)" strokeWidth={2} />
          </>
        )}
        <text x={0} y={height + 13} fontSize={9} fill="var(--text-muted)">
          1
        </text>
        <text x={width} y={height + 13} textAnchor="end" fontSize={9} fill="var(--text-muted)">
          {points.length}
        </text>
      </svg>

      {mode === "running" && comparison && (
        <p className="trend-foot">
          <span style={{ color: "var(--baseline)" }}>┄</span> same point last month ·{" "}
          {(() => {
            const thenAtSamePoint = comparison[Math.min(comparison.length - 1, points.length - 1)] ?? 0;
            const difference = total - thenAtSamePoint;
            if (Math.abs(difference) < 1) return "running level with it";
            return `${money(Math.abs(difference))} ${difference > 0 ? "ahead of" : "behind"} it`;
          })()}
        </p>
      )}
    </>
  );
}
