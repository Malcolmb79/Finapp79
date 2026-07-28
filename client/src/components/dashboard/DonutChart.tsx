import { formatCurrency } from "../../utils/formatCurrency.js";

export interface DonutSlice {
  label: string;
  value: number;
}

const SIZE = 160;
const THICKNESS = 26;
const RADIUS = (SIZE - THICKNESS) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Enough distinct hues to read apart at a glance; beyond this the tail is
// grouped rather than given colours nobody can tell apart.
const HUES = [
  "var(--cat-1, #e05252)",
  "var(--cat-2, #e0912e)",
  "var(--cat-3, #d9c22b)",
  "var(--cat-4, #4fa860)",
  "var(--cat-5, #3d8ecf)",
  "var(--cat-6, #7a5cd0)",
];

/**
 * Composition of a total, as a ring.
 *
 * A bar list ranks; a ring shows share — whether one category is most of the
 * spending or it is spread evenly is obvious here and has to be worked out
 * from a list. Categorical hues rather than one graduated colour, since the
 * slices are different things rather than more or less of one thing.
 *
 * Everything past the sixth is grouped: a ring with twenty slices is a
 * pattern, not a reading, and the colours stop being distinguishable long
 * before that.
 */
export default function DonutChart({ data, currency }: { data: DonutSlice[]; currency: string | null }) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return <p className="empty-state">Nothing to show yet.</p>;

  const head = sorted.slice(0, HUES.length - 1);
  const tail = sorted.slice(HUES.length - 1);
  const slices = tail.length > 0 ? [...head, { label: `Other (${tail.length})`, value: tail.reduce((sum, d) => sum + d.value, 0) }] : head;

  const total = slices.reduce((sum, d) => sum + d.value, 0);
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  let offset = 0;

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }} role="img" aria-label="Share of spending by category">
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {slices.map((slice, i) => {
            const fraction = slice.value / total;
            const dash = fraction * CIRCUMFERENCE;
            const circle = (
              <circle
                key={slice.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={HUES[i % HUES.length]}
                strokeWidth={THICKNESS}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${slice.label}: ${money(slice.value)} (${(fraction * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += dash;
            return circle;
          })}
        </g>
        <text x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle" fontSize="0.78rem" fill="var(--text-muted)">
          Total
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle" fontSize="0.9rem" fontWeight="600" fill="var(--text)">
          {money(total)}
        </text>
      </svg>

      <div style={{ flex: 1, minWidth: 140, display: "grid", gap: "0.3rem" }}>
        {slices.map((slice, i) => (
          <div key={slice.label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: HUES[i % HUES.length], flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slice.label}</span>
            <strong>{((slice.value / total) * 100).toFixed(0)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
