import { useMemo } from "react";
import { cashFlow, type CashFlow, type FlowEntry } from "../../utils/cashFlowSankey.js";
import { formatCurrency } from "../../utils/formatCurrency.js";

/**
 * Where the month's money came from and where it went, as one flow.
 *
 * Income and expenses already appear as two bars, and spending as a ring of
 * categories. Neither answers what people actually ask of a month: of what
 * came in, how much reached each thing, and was there anything left. Two
 * charts leave that sum to the eye, and the sum is the point.
 *
 * Width is share. That is the whole value of the shape — "most of it went on
 * rent" becomes something seen rather than worked out — so every band is
 * drawn in proportion to the money it carries, including the long tail, which
 * is grouped rather than dropped so the picture still adds up to the figures
 * printed beside it.
 */

const HEIGHT = 300;
const WIDTH = 680;
const COLUMN = 148;
const GAP = 3;

/**
 * Only tokens the theme actually defines, so the bands stay distinguishable
 * in both light and dark rather than resolving to nothing. The sequential
 * steps run dark to light, then the accents, then muted for the grouped tail
 * — which should read as the least interesting band on the chart, because it
 * is.
 */
const DESTINATION_TONES = [
  "var(--seq-600)",
  "var(--seq-450)",
  "var(--accent-3)",
  "var(--seq-250)",
  "var(--warning)",
  "var(--seq-100)",
  "var(--critical)",
  "var(--text-muted)",
];

/** Vertical bands sized by share, in the order given. */
function stack(entries: FlowEntry[], total: number, height: number) {
  const usable = Math.max(0, height - GAP * Math.max(0, entries.length - 1));
  let y = 0;
  return entries.map((entry) => {
    const band = total > 0 ? (entry.amount / total) * usable : 0;
    const placed = { entry, y, height: band };
    y += band + GAP;
    return placed;
  });
}

/** A ribbon from one band to another, curved so the eye can follow it. */
function ribbon(y1: number, h1: number, y2: number, h2: number): string {
  const x1 = COLUMN;
  const x2 = WIDTH - COLUMN;
  const mid = (x1 + x2) / 2;
  return [
    `M${x1},${y1}`,
    `C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
    `L${x2},${y2 + h2}`,
    `C${mid},${y2 + h2} ${mid},${y1 + h1} ${x1},${y1 + h1}`,
    "Z",
  ].join(" ");
}

export default function CashFlowSankey({
  transactions,
  categoryName,
  currency,
}: {
  transactions: Parameters<typeof cashFlow>[0];
  categoryName: (id: number | null) => string | null;
  currency: string | null;
}) {
  const flow: CashFlow = useMemo(() => cashFlow(transactions, categoryName), [transactions, categoryName]);
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  if (flow.totalIn === 0 && flow.totalOut === 0) {
    return <p className="empty-state">Nothing moved in this period.</p>;
  }

  // Both sides are drawn against the larger total, so a month that spent more
  // than it earned shows a right-hand side visibly taller than the left —
  // which is the honest picture of being funded from savings.
  const scale = Math.max(flow.totalIn, flow.totalOut);
  const sources = stack(flow.sources, scale, HEIGHT);
  const destinations = stack(flow.destinations, scale, HEIGHT);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <div>
          <p className="stat-tile__label">In</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(flow.totalIn)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Out</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>{money(flow.totalOut)}</p>
        </div>
        <div>
          <p className="stat-tile__label">{flow.surplus >= 0 ? "Left over" : "From savings"}</p>
          <p
            className={`stat-tile__value${flow.surplus >= 0 ? " stat-tile__value--good" : ""}`}
            style={{ fontSize: "1.05rem" }}
          >
            {money(Math.abs(flow.surplus))}
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="xMidYMid meet">
        {/* Ribbons first, so the solid bands sit on top of their ends. Each
            source is spread across the destinations in proportion, because
            a pound of salary is not traceable to a particular category —
            drawing it as though it were would be inventing detail the data
            does not have. */}
        {sources.map((source) =>
          destinations.map((destination, di) => {
            const share = scale > 0 ? destination.entry.amount / scale : 0;
            const h1 = source.height * (scale > 0 ? destination.entry.amount / Math.max(scale, 1) : 0);
            const offsetIn = destinations.slice(0, di).reduce((sum, d) => sum + source.height * (d.entry.amount / Math.max(scale, 1)), 0);
            if (h1 <= 0.5 || share <= 0) return null;
            return (
              <path
                key={`${source.entry.key}-${destination.entry.key}`}
                d={ribbon(source.y + offsetIn, h1, destination.y, destination.height)}
                fill={DESTINATION_TONES[di % DESTINATION_TONES.length]}
                opacity="0.22"
              />
            );
          })
        )}

        {sources.map((source) => (
          <g key={source.entry.key}>
            <rect x={COLUMN - 10} y={source.y} width="10" height={Math.max(1, source.height)} rx="2" fill="var(--good)" />
            <text x={COLUMN - 16} y={source.y + source.height / 2} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--text-primary)">
              {source.entry.label}
            </text>
          </g>
        ))}

        {destinations.map((destination, index) => (
          <g key={destination.entry.key}>
            <rect
              x={WIDTH - COLUMN}
              y={destination.y}
              width="10"
              height={Math.max(1, destination.height)}
              rx="2"
              fill={DESTINATION_TONES[index % DESTINATION_TONES.length]}
            />
            <text
              x={WIDTH - COLUMN + 16}
              y={destination.y + destination.height / 2}
              dominantBaseline="middle"
              fontSize="11"
              fill="var(--text-primary)"
            >
              {destination.entry.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
