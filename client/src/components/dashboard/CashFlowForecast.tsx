import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "../../utils/formatCurrency.js";
import type { Forecast } from "../../utils/forecast.js";
import { useMeasuredSize } from "../../utils/useMeasuredSize.js";

/**
 * Where the balance goes next, if nothing unusual happens.
 *
 * The one view here that answers the question people actually open a banking
 * app for — will there be enough before payday — and the figure that answers
 * it is the low point, not the end point. A month that finishes comfortably
 * having gone £200 overdrawn on the 14th is not a comfortable month, and an
 * end-of-period number hides exactly that.
 *
 * So the low is the headline, the line is the context, and the caveat is
 * permanent: this knows what repeats and nothing else.
 */

const CHART_HEIGHT = 120;
const MIN_CHART_HEIGHT = 60;
const LABEL_ROW = 18;

export default function CashFlowForecast({
  forecast,
  currency,
  horizonDays,
}: {
  forecast: Forecast;
  currency: string | null;
  horizonDays: number;
}) {
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));
  const [plotRef, plot] = useMeasuredSize(560, CHART_HEIGHT + LABEL_ROW);
  const { points, low } = forecast;

  if (points.length === 0) return <p className="empty-state">Nothing to project yet.</p>;

  const width = plot.width;
  const height = Math.max(MIN_CHART_HEIGHT, plot.height - LABEL_ROW);

  const values = points.map((point) => point.balance);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const x = (index: number) => (index / Math.max(1, points.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / span) * (height - 4) - 2;

  const path = points.map((point, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(point.balance).toFixed(1)}`).join(" ");
  const area = `${path} L${width.toFixed(1)},${y(min).toFixed(1)} L0,${y(min).toFixed(1)} Z`;
  const zeroY = min < 0 && max > 0 ? y(0) : null;
  const lowIndex = low ? points.findIndex((point) => point.date === low.date) : -1;

  const endsBelowZero = points[points.length - 1].balance < 0;
  const dipsBelowZero = low !== null && low.balance < 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="stat-row" style={{ marginBottom: "0.8rem" }}>
        <div>
          {/* The headline is the worst it gets, not where it ends up: a month
              that finishes fine having gone overdrawn on the 14th is not a
              month that went fine. */}
          <p className="stat-tile__label">Lowest point</p>
          <p className={`stat-tile__value${dipsBelowZero ? "" : " stat-tile__value--good"}`}>{low ? money(low.balance) : "—"}</p>
        </div>
        <div>
          <p className="stat-tile__label">On</p>
          <p className="stat-tile__value">
            {low ? new Date(`${low.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">In {horizonDays} days</p>
          <p className={`stat-tile__value${endsBelowZero ? "" : " stat-tile__value--good"}`}>
            {money(points[points.length - 1].balance)}
          </p>
        </div>
      </div>

      <div ref={plotRef} style={{ width: "100%", flex: 1, minHeight: MIN_CHART_HEIGHT + LABEL_ROW, overflow: "hidden" }}>
        <svg width={width} height={height} style={{ display: "block" }}>
          <defs>
            <linearGradient id="forecast-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dipsBelowZero ? "var(--critical)" : "var(--seq-450)"} stopOpacity="0.28" />
              <stop offset="100%" stopColor={dipsBelowZero ? "var(--critical)" : "var(--seq-450)"} stopOpacity="0" />
            </linearGradient>
          </defs>
          {zeroY !== null && (
            <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="var(--critical)" strokeWidth="1" strokeDasharray="3 3" />
          )}
          <path d={area} fill="url(#forecast-fill)" />
          <path d={path} fill="none" stroke={dipsBelowZero ? "var(--critical)" : "var(--seq-450)"} strokeWidth="2" />
          {lowIndex >= 0 && low && <circle cx={x(lowIndex)} cy={y(low.balance)} r="3.5" fill={dipsBelowZero ? "var(--critical)" : "var(--seq-450)"} />}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
          <span>today</span>
          <span>{new Date(`${points[points.length - 1].date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        </div>
      </div>

      {/* A forecast missing the salary would show a household running out of
          money every month, so the absence is named rather than papered over. */}
      {!forecast.incomeFound && (
        <p style={{ fontSize: "0.72rem", color: "var(--critical)", margin: "0.5rem 0 0", display: "flex", alignItems: "flex-start", gap: "0.3rem" }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No regular income found yet, so this only goes down. It needs three matching credits to spot a salary.</span>
        </p>
      )}

      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
        From {forecast.commitments} regular payment{forecast.commitments === 1 ? "" : "s"} — if nothing unusual happens.
      </p>
    </div>
  );
}
