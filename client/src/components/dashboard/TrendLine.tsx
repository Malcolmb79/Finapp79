import { useMeasuredWidth } from "../../utils/useMeasuredWidth.js";

export interface TrendLinePoint {
  label: string;
  value: number | null;
}

const HEIGHT = 130;
const PAD = 6;

/**
 * A value over time, with a zero line and its own scale.
 *
 * Shares the reasoning the net worth chart arrived at: the scale follows the
 * data rather than being anchored to zero, because a series that lives between
 * 40 and 60 is a flat line on a 0-100 axis and the movement is the point. Zero
 * is drawn when it falls inside the range, which for a savings rate is the
 * line between a month that kept something and one that didn't.
 *
 * Gaps are gaps: a month with no income has no savings rate, and joining
 * across it would invent a number.
 */
export default function TrendLine({
  points,
  format,
  goodAbove = 0,
}: {
  points: TrendLinePoint[];
  format: (value: number) => string;
  /** Values above this read as good, below as bad — colours the fill. */
  goodAbove?: number;
}) {
  const [ref, width] = useMeasuredWidth(420);
  const known = points.filter((p): p is { label: string; value: number } => p.value != null);
  if (known.length < 2) return <p className="empty-state">Not enough history for a trend yet.</p>;

  const values = known.map((p) => p.value);
  const low = Math.min(...values, goodAbove);
  const high = Math.max(...values, goodAbove);
  const padding = (high - low || Math.abs(high) || 1) * 0.15;
  const min = low - padding;
  const max = high + padding;

  const xFor = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * width : width / 2);
  const yFor = (value: number) => HEIGHT - PAD - ((value - min) / (max - min)) * (HEIGHT - PAD * 2);

  // Segments rather than one path, so a gap in the data is a gap in the line.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((point, i) => {
    if (point.value == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xFor(i), y: yFor(point.value) });
  });
  if (current.length > 0) segments.push(current);

  const last = known[known.length - 1].value;
  const stroke = last >= goodAbove ? "var(--good)" : "var(--critical)";
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(width / 56))));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={HEIGHT} style={{ display: "block", overflow: "visible" }}>
        {min < goodAbove && max > goodAbove && (
          <line x1={0} x2={width} y1={yFor(goodAbove)} y2={yFor(goodAbove)} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
        )}
        {segments.map((segment, i) => (
          <path
            key={i}
            d={segment.map((p, j) => `${j === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {segments.flat().length <= 24 &&
          points.map((point, i) =>
            point.value == null ? null : (
              <circle key={i} cx={xFor(i)} cy={yFor(point.value)} r={2.5} fill="var(--surface-1)" stroke={stroke} strokeWidth={1.5}>
                <title>{`${point.label}: ${format(point.value)}`}</title>
              </circle>
            )
          )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
        {points.map((point, i) => (
          <span key={point.label} style={{ visibility: i % labelStep === 0 || i === points.length - 1 ? "visible" : "hidden" }}>
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}
