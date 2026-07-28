import { formatCurrency } from "../../utils/formatCurrency.js";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth.js";

export interface TrendPoint {
  label: string;
  value: number;
}

const CHART_HEIGHT = 150;
const MARKER_RADIUS = 2.5;

/** Short enough for an axis: 35,806 becomes -35.8k, 950 stays 950. */
function axisLabel(value: number, currency?: string): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const thousands = value / 1000;
    const rounded = Math.abs(thousands) >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
    return `${rounded}k`;
  }
  return currency ? formatCurrency(value, currency).replace(/\.00$/, "") : String(Math.round(value));
}

/**
 * Net worth over time.
 *
 * The scale follows the data rather than being anchored to zero. Anchoring is
 * the conventional advice, and it is wrong here: net worth spent this year
 * between -30k and -35k, so a scale running to zero pressed every point into
 * the bottom eighth of the card and drew a flat line that said nothing. What
 * matters on this chart is the movement, and the movement is the part that got
 * squashed. Zero is still drawn when it falls inside the range, so a crossing
 * into or out of debt is never invisible.
 */
export default function NetWorthCard({
  current,
  delta,
  points,
  mode = "chart",
  currency,
  unconvertible = [],
}: {
  current: number;
  delta: number;
  points: TrendPoint[];
  mode?: "chart" | "number";
  /** Currency the figure has been converted into, when accounts span several. */
  currency?: string;
  /** Currencies with no available rate — their balances are missing from the total. */
  unconvertible?: string[];
}) {
  // Drawn at the width it actually has rather than stretched to fit: a
  // stretched SVG turns point markers into ellipses and thickens the line
  // unevenly.
  const [plotRef, plotWidth] = useMeasuredWidth(420);

  const values = points.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A flat series would otherwise divide by zero and pin the line to an edge.
  const padding = (high - low || Math.abs(high) || 1) * 0.15;
  const min = low - padding;
  const max = high + padding;
  const range = max - min;

  const xFor = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2);
  const yFor = (value: number) => CHART_HEIGHT - ((value - min) / range) * CHART_HEIGHT;

  const coords = points.map((p, i) => [xFor(i), yFor(p.value)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = coords.length > 0 ? `${linePath} L${plotWidth},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z` : "";

  // Three labelled levels is as many as reads without crowding at this size.
  const levels = [max, (max + min) / 2, min];
  const zeroInRange = min < 0 && max > 0;

  // Every month on a phone-width chart would overlap, so labels thin out to
  // roughly one per 60px while always keeping the first and last.
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 60))));

  return (
    <div>
      <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
        Net worth
      </p>
      <p className="stat-tile__value" style={{ fontSize: "2rem" }}>
        {currency ? formatCurrency(current, currency) : current.toFixed(2)}
      </p>
      <p className={`sidebar__net-worth-delta`} style={{ margin: "0.2rem 0 0" }}>
        {delta >= 0 ? "↗" : "↘"} {currency ? formatCurrency(delta, currency) : delta.toFixed(2)} this month
      </p>
      {/* Named explicitly: a single figure drawn from accounts in several
          currencies is only meaningful if you know which one it's in. */}
      {currency && (
        <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Converted to {currency} at ECB rates
        </p>
      )}
      {unconvertible.length > 0 && (
        <p role="alert" style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "var(--warning)" }}>
          Excludes {unconvertible.join(", ")} — no rate available
        </p>
      )}

      {mode === "chart" && points.length > 1 ? (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
          {/* Values as HTML beside the plot rather than text inside the SVG,
              so they stay crisp and readable at any card size. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: CHART_HEIGHT,
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              textAlign: "right",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {levels.map((value, i) => (
              <span key={i}>{axisLabel(value, currency)}</span>
            ))}
          </div>

          <div ref={plotRef} style={{ flex: 1, minWidth: 0 }}>
            <svg width={plotWidth} height={CHART_HEIGHT} style={{ display: "block", overflow: "visible" }}>
              <defs>
                <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--seq-450)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--seq-450)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {levels.map((value, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={plotWidth}
                  y1={yFor(value)}
                  y2={yFor(value)}
                  stroke="var(--gridline)"
                  strokeWidth={1}
                />
              ))}

              {/* Only when it's on the chart — a crossing between owing and
                  owning is the one line worth calling out. */}
              {zeroInRange && (
                <line x1={0} x2={plotWidth} y1={yFor(0)} y2={yFor(0)} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
              )}

              <path d={areaPath} fill="url(#netWorthFill)" stroke="none" />
              <path d={linePath} fill="none" stroke="var(--seq-450)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {coords.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={MARKER_RADIUS} fill="var(--surface-1)" stroke="var(--seq-450)" strokeWidth={1.5}>
                  <title>{`${points[i].label}: ${currency ? formatCurrency(points[i].value, currency) : points[i].value.toFixed(2)}`}</title>
                </circle>
              ))}
            </svg>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.68rem",
                color: "var(--text-muted)",
                marginTop: "0.3rem",
              }}
            >
              {points.map((p, i) => (
                <span key={p.label} style={{ visibility: i % labelStep === 0 || i === points.length - 1 ? "visible" : "hidden" }}>
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : mode === "chart" ? (
        <p className="empty-state">Not enough history for a trend yet.</p>
      ) : null}
    </div>
  );
}
