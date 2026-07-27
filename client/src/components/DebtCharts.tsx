import { useEffect, useState } from "react";
import { api, type Account, type DebtProjection } from "../api/client.js";
import { accountBalance, amountDrawn } from "../utils/accountBalance.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * The debt picture, drawn.
 *
 * Three things a table doesn't show well: how the total falls over time and
 * when it reaches zero, how much of each facility is used, and which debts
 * make up the balance.
 *
 * The payoff curve comes from the server's simulator rather than being
 * recomputed here, so the chart and the figures the adviser quotes are the
 * same arithmetic — and it stays in the one place that has tests.
 */

const CHART_WIDTH = 560;
const CHART_HEIGHT = 150;
const PAD = 4;

function PayoffCurve({ projection }: { projection: DebtProjection }) {
  const baseline = projection.minimums.balanceByMonth;
  const faster = projection.withExtra?.balanceByMonth ?? null;
  if (baseline.length < 2) return null;

  const span = Math.max(baseline.length, faster?.length ?? 0) - 1;
  const peak = Math.max(...baseline, ...(faster ?? [0]));

  const path = (series: number[]) =>
    series
      .map((value, i) => {
        const x = span > 0 ? (i / span) * CHART_WIDTH : 0;
        const y = CHART_HEIGHT - PAD - (peak > 0 ? (value / peak) * (CHART_HEIGHT - PAD * 2) : 0);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const clearsIn = projection.minimums.months;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
        What you owe, month by month
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.4rem" }}>
        {projection.minimums.neverClears
          ? "At these payments the balance never clears — the interest is outrunning them."
          : `Clear in ${clearsIn} month${clearsIn === 1 ? "" : "s"} at the current payments`}
        {faster && projection.withExtra?.months != null && !projection.withExtra.neverClears
          ? ` · ${projection.withExtra.months} with the extra`
          : ""}
      </p>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height={CHART_HEIGHT} preserveAspectRatio="none">
        <path d={`${path(baseline)} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`} fill="var(--accent)" opacity={0.12} />
        <path d={path(baseline)} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {faster && (
          // Dashed so the two lines stay apart without relying on colour
          // alone to tell them apart.
          <path
            d={path(faster)}
            fill="none"
            stroke="var(--good)"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)" }}>
        <span>now</span>
        <span>{span} months</span>
      </div>
    </div>
  );
}

/**
 * How much of each facility is in use.
 *
 * The bar is the limit and the fill is what's drawn, so a card near its
 * ceiling is obvious at a glance in a way a pair of numbers isn't.
 */
function Utilisation({ accounts, txSums }: { accounts: Account[]; txSums: Map<string, number> }) {
  const withLimits = accounts.filter((a) => (a.overdraft_limit ?? 0) > 0);
  if (withLimits.length === 0) return null;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <p className="stat-tile__label" style={{ marginBottom: "0.4rem" }}>
        How much of each facility is used
      </p>
      {withLimits.map((a) => {
        const drawn = amountDrawn(a, txSums.get(a.id) ?? 0);
        const limit = a.overdraft_limit ?? 0;
        const pct = limit > 0 ? Math.min(100, (drawn / limit) * 100) : 0;
        // Past four-fifths of a facility is where lenders start treating an
        // account differently, so it earns a colour rather than a number.
        const tone = pct >= 80 ? "var(--critical)" : pct >= 50 ? "var(--warn, var(--accent-3))" : "var(--accent)";
        return (
          <div className="bar-list__row" key={a.id}>
            <div className="bar-list__meta">
              <span>{a.name}</span>
              <strong style={{ fontSize: "0.8rem" }}>
                {formatCurrency(drawn, a.currency)} / {formatCurrency(limit, a.currency)} · {Math.round(pct)}%
              </strong>
            </div>
            <div className="bar-list__track">
              <div className="bar-list__fill" style={{ width: `${pct}%`, background: tone }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the balance is made of, largest first. */
function Composition({ projection }: { projection: DebtProjection }) {
  const debts = [...projection.debts].sort((a, b) => b.balance - a.balance);
  const total = debts.reduce((sum, d) => sum + d.balance, 0);
  if (debts.length < 2 || total <= 0) return null;

  return (
    <div>
      <p className="stat-tile__label" style={{ marginBottom: "0.4rem" }}>
        What the {formatCurrency(total, projection.currency)} is made of
      </p>
      {debts.map((d) => (
        <div className="bar-list__row" key={d.name}>
          <div className="bar-list__meta">
            <span>
              {d.name}
              {d.rate > 0 && <span style={{ color: "var(--text-muted)" }}> · {d.rate}%</span>}
            </span>
            <strong style={{ fontSize: "0.8rem" }}>{formatCurrency(d.balance, projection.currency)}</strong>
          </div>
          <div className="bar-list__track">
            <div className="bar-list__fill" style={{ width: `${(d.balance / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DebtCharts({ accounts, txSums }: { accounts: Account[]; txSums: Map<string, number> }) {
  const [projections, setProjections] = useState<DebtProjection[] | null>(null);
  const [extra, setExtra] = useState(0);

  useEffect(() => {
    api.debtProjection(extra).then(setProjections).catch(() => setProjections([]));
  }, [extra]);

  const drawn = accounts.filter((a) => accountBalance(a, txSums.get(a.id) ?? 0) < 0);
  if (drawn.length === 0 && accounts.every((a) => !a.overdraft_limit)) return null;

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div className="card__header">
        <h2 className="card__title">The shape of it</h2>
      </div>

      {projections === null && <p className="empty-state">Working it out…</p>}

      {projections?.map((projection) => (
        <div key={projection.currency} style={{ marginBottom: "1rem" }}>
          {/* Each currency gets its own chart — they are paid from different
              pockets, and one curve across them would be a fiction. */}
          {projections.length > 1 && (
            <p style={{ fontSize: "0.78rem", fontWeight: 600, margin: "0 0 0.4rem" }}>{projection.currency}</p>
          )}
          <PayoffCurve projection={projection} />
          <Composition projection={projection} />
        </div>
      ))}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.75rem 0" }}>
        <label style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Extra per month</label>
        <input
          type="range"
          min={0}
          max={1000}
          step={50}
          value={extra}
          onChange={(e) => setExtra(Number(e.target.value))}
          style={{ flex: 1, maxWidth: 240 }}
        />
        <strong style={{ fontSize: "0.82rem", minWidth: 48 }}>{extra}</strong>
      </div>

      <Utilisation accounts={accounts} txSums={txSums} />
    </div>
  );
}
