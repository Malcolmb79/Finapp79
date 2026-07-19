export interface TrendPoint {
  label: string;
  value: number;
}

/**
 * Single-series trend over time -> line + area wash, one hue (dataviz
 * skill: "trend over time -> line; area for a single series -> sequential
 * or 1 categorical"). No axis/gridlines at this size — it's a sparkline-
 * scale trend, not an analytical chart; the number carries the value.
 */
export default function NetWorthCard({
  current,
  delta,
  points,
  mode = "chart",
}: {
  current: number;
  delta: number;
  points: TrendPoint[];
  mode?: "chart" | "number";
}) {
  const width = 560;
  const height = 140;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * width : width / 2;
    const y = height - ((p.value - min) / range) * (height - 10) - 5;
    return [x, y] as const;
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = coords.length > 0 ? `${linePath} L${width},${height} L0,${height} Z` : "";

  return (
    <div>
      <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
        Net worth
      </p>
      <p className="stat-tile__value" style={{ fontSize: "2rem" }}>
        {current.toFixed(2)}
      </p>
      <p className={`sidebar__net-worth-delta`} style={{ margin: "0.2rem 0 1rem" }}>
        {delta >= 0 ? "↗" : "↘"} {delta.toFixed(2)} this month
      </p>
      {mode === "chart" && points.length > 1 ? (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--seq-450)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--seq-450)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#netWorthFill)" stroke="none" />
          <path d={linePath} fill="none" stroke="var(--seq-450)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : mode === "chart" ? (
        <p className="empty-state">Not enough history for a trend yet.</p>
      ) : null}
    </div>
  );
}
