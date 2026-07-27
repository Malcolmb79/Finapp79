import { useEffect, useState } from "react";
import { api, type Account, type DebtProjection } from "../api/client.js";

import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * Each borrowing account, drawn: how its balance falls, when it clears, and
 * how much of its facility is in use.
 *
 * One chart per account rather than one across all of them. "When does this
 * clear" is a question about a particular debt, and a combined curve answers
 * something different — they look alike and are easy to confuse.
 *
 * The curves are served from the same simulator the adviser quotes rather than
 * recomputed here, so a chart and the figures beside it cannot disagree, and
 * the arithmetic stays in the one place that has tests.
 */

const CHART_WIDTH = 320;
const CHART_HEIGHT = 90;
const PAD = 4;

function curvePath(series: number[], span: number, peak: number): string {
  return series
    .map((value, i) => {
      const x = span > 0 ? (i / span) * CHART_WIDTH : 0;
      const y = CHART_HEIGHT - PAD - (peak > 0 ? (value / peak) * (CHART_HEIGHT - PAD * 2) : 0);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function months(count: number | null): string {
  if (count === null) return "never at this rate";
  if (count === 0) return "cleared";
  if (count < 24) return `${count} month${count === 1 ? "" : "s"}`;
  return `${Math.floor(count / 12)}y ${count % 12}m`;
}

function AccountChart({ projection, account }: { projection: DebtProjection; account: Account | undefined }) {
  const baseline = projection.minimums.balanceByMonth;
  const faster = projection.withExtra?.balanceByMonth ?? null;

  const span = Math.max(baseline.length, faster?.length ?? 0) - 1;
  const peak = Math.max(...baseline, ...(faster ?? [0]));

  // The server worked the balance out with the same rule the Accounts page
  // uses, so it is the figure to measure the facility against — recomputing
  // it here from transactions would risk the two disagreeing.
  const limit = account?.overdraft_limit ?? 0;
  const utilisation = limit > 0 ? Math.min(100, (projection.balance / limit) * 100) : null;
  // Past four-fifths of a facility is where lenders start treating an account
  // differently, so it earns a colour rather than just a number.
  const tone = utilisation === null ? "var(--accent)" : utilisation >= 80 ? "var(--critical)" : utilisation >= 50 ? "var(--accent-3)" : "var(--accent)";

  const saved =
    projection.withExtra && !projection.withExtra.neverClears && !projection.minimums.neverClears
      ? projection.minimums.totalInterest - projection.withExtra.totalInterest
      : null;

  return (
    <div style={{ padding: "0.6rem 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.88rem" }}>{projection.name}</strong>
        <span style={{ fontSize: "0.85rem" }}>{formatCurrency(projection.balance, projection.currency)}</span>
      </div>
      <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0.15rem 0 0.4rem" }}>
        {[
          projection.rate > 0 ? `${projection.rate}% a year` : "no rate recorded",
          projection.minimumIsAssumed
            ? `${formatCurrency(projection.minimumPayment, projection.currency)}/mo assumed`
            : `${formatCurrency(projection.minimumPayment, projection.currency)}/mo`,
          projection.minimums.neverClears ? "never clears at this payment" : `clear in ${months(projection.minimums.months)}`,
        ].join(" · ")}
      </p>

      {span > 0 && (
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height={CHART_HEIGHT} preserveAspectRatio="none">
          <path
            d={`${curvePath(baseline, span, peak)} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`}
            fill={tone}
            opacity={0.12}
          />
          <path d={curvePath(baseline, span, peak)} fill="none" stroke={tone} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {/* Dashed rather than a second colour, so the two lines stay
              distinguishable however the theme renders them. */}
          {faster && (
            <path
              d={curvePath(faster, span, peak)}
              fill="none"
              stroke="var(--good)"
              strokeWidth={2}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}

      {/* A curve drawn from a stand-in payment is the one most worth
          doubting, so it says so rather than looking like the agreement. */}
      {projection.minimumIsAssumed && (
        <p style={{ fontSize: "0.71rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          No payment imported yet, so this assumes a typical{" "}
          {projection.rate > 0 ? "card minimum — 1% of the balance plus interest, falling as the balance does" : "minimum payment"}.
          Import a statement or the agreement to replace it.
        </p>
      )}

      {projection.withExtra && (
        <p style={{ fontSize: "0.73rem", color: "var(--good)", margin: "0.2rem 0 0" }}>
          With the extra: {months(projection.withExtra.months)}
          {saved !== null && saved > 0 ? ` · ${formatCurrency(saved, projection.currency)} less interest` : ""}
        </p>
      )}

      {utilisation !== null && (
        <div style={{ marginTop: "0.45rem" }}>
          <div className="bar-list__meta" style={{ fontSize: "0.72rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Facility used</span>
            <strong>
              {Math.round(utilisation)}% of {formatCurrency(limit, projection.currency)}
            </strong>
          </div>
          <div className="bar-list__track">
            <div className="bar-list__fill" style={{ width: `${utilisation}%`, background: tone }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function DebtCharts({ accounts }: { accounts: Account[] }) {
  const [projections, setProjections] = useState<DebtProjection[] | null>(null);
  const [extra, setExtra] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .debtProjection(extra)
      .then((result) => !cancelled && setProjections(result))
      .catch(() => !cancelled && setProjections([]));
    return () => {
      cancelled = true;
    };
  }, [extra]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div className="card__header">
        <h2 className="card__title">Each account, over time</h2>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          Every account on its own payments. Move the slider to see what an extra payment aimed at each one would do.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
        <label htmlFor="debt-extra" style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          Extra per month
        </label>
        <input
          id="debt-extra"
          type="range"
          min={0}
          max={1000}
          step={50}
          value={extra}
          onChange={(e) => setExtra(Number(e.target.value))}
          style={{ flex: 1, maxWidth: 240 }}
        />
        <strong style={{ fontSize: "0.82rem", minWidth: 40 }}>{extra}</strong>
      </div>

      {projections === null && <p className="empty-state">Working it out…</p>}
      {projections?.length === 0 && <p className="empty-state">Nothing owed to chart.</p>}
      {projections?.map((p) => (
        <AccountChart key={p.accountId} projection={p} account={accountsById.get(p.accountId)} />
      ))}
    </div>
  );
}
