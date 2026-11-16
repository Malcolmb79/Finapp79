import type { Source } from "../../utils/dashboardSummary.js";

/**
 * Where the month's money came from.
 *
 * The counterpart to spending by category, and the one almost no dashboard
 * bothers with — income gets a single total and spending gets a donut, as
 * though only one of them had any structure.
 *
 * It earns its place by showing concentration. A household whose income is
 * ninety per cent one salary and one whose income is three roughly equal
 * sources have the same total and completely different exposure, and that is
 * visible here and nowhere else in the app.
 */

export default function IncomeSources({ sources, money }: { sources: Source[]; money: (value: number) => string }) {
  if (sources.length === 0) {
    return <p className="empty-state">Nothing came in this month yet.</p>;
  }

  const total = sources.reduce((sum, source) => sum + source.amount, 0);
  const largest = sources[0];

  return (
    <>
      <p className="stat-tile__label">In this month</p>
      <p className="stat-tile__value" style={{ fontSize: "1.3rem", marginBottom: "0.2rem" }}>
        {money(total)}
      </p>
      {/* The sentence the list is for. Said only where there is more than one
          source, because "100% from your only source" is not an insight. */}
      <p className="trend-head__detail" style={{ marginBottom: "0.7rem" }}>
        {sources.length === 1
          ? `all of it from ${largest.label}`
          : `${Math.round(largest.share * 100)}% of it from ${largest.label}, across ${sources.length} sources`}
      </p>

      <div style={{ display: "grid", gap: "0.45rem" }}>
        {sources.map((source) => (
          <div key={source.label}>
            <div className="budget-row__meta">
              <span style={{ fontSize: "0.82rem" }}>{source.label}</span>
              <span className="budget-row__amounts">
                {money(source.amount)}{" "}
                {/* A real space, not only the margin: a CSS gap is invisible
                    to anything reading the text, so copied or spoken aloud
                    the two figures ran together as "4,200.0051%". */}
                <span style={{ color: "var(--text-muted)", marginLeft: "0.2rem" }}>
                  {Math.round(source.share * 100)}%
                </span>
              </span>
            </div>
            <div className="budget-row__track">
              <div className="budget-row__fill" data-status="good" style={{ width: `${source.share * 100}%` }} />
            </div>
            {source.count > 1 && (
              <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", margin: "0.1rem 0 0" }}>
                {source.count} payments
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
