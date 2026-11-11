import { useMemo, useState } from "react";
import type { DebtProjection, FxRates } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { toBase } from "../utils/fx.js";
import { combine, duration } from "../utils/debtTimeline.js";

/**
 * Every debt on one line, and the date it reaches zero.
 *
 * The per-account charts below answer "when does this one clear". Nobody owes
 * money one account at a time, though — the question people actually carry
 * around is when they stop owing anything at all, and that answer is in none
 * of those charts. Adding them up by eye is impossible: the accounts clear at
 * different times, so the total's shape is not any individual curve's.
 *
 * Accounts can be switched off because the useful question is usually
 * conditional. "What if I ignore the mortgage", "what if I clear the card
 * first" — a total that cannot be narrowed answers only the one question
 * nobody asked.
 *
 * The horizon is a slider rather than a fixed window. A debt that clears in
 * eight months and one that runs for twelve years cannot share a sensible
 * fixed axis: either the short one is a vertical line at the left edge or the
 * long one runs off the end.
 */

const CHART_HEIGHT = 170;
const CHART_WIDTH = 720;

/** Enough distinct hues for the accounts anybody has, reused beyond that. */
const SERIES_COLOURS = ["var(--seq-450)", "var(--good)", "var(--accent-3)", "var(--warning)", "var(--critical)"];

function monthLabel(offset: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

/**
 * One account's balance in the base currency, month by month.
 *
 * `balanceByMonth` stops at the month an account clears, so a shorter series
 * is a cleared debt rather than missing data — it reads as zero from then on,
 * which is what it is.
 */
function convertedSeries(projection: DebtProjection, useExtra: boolean, rates: FxRates | null): number[] | null {
  const raw = useExtra && projection.withExtra ? projection.withExtra.balanceByMonth : projection.minimums.balanceByMonth;
  // One rate for the whole series: the figures are a projection of today's
  // balance, so applying today's rate to all of them is the same assumption
  // the projection already makes about the interest rate holding.
  const rate = toBase(1, projection.currency, rates);
  // No rate for this currency: excluded and said so, rather than added in at
  // face value as though a pound were a euro.
  if (rate === null) return null;
  return raw.map((balance) => balance * rate);
}

function curvePath(series: number[], span: number, peak: number): string {
  if (series.length === 0 || peak <= 0) return "";
  return series
    .map((value, index) => {
      const x = span === 0 ? 0 : (index / span) * CHART_WIDTH;
      const y = CHART_HEIGHT - (value / peak) * (CHART_HEIGHT - 10);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function DebtTimeline({ projections, rates }: { projections: DebtProjection[]; rates: FxRates | null }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [horizon, setHorizon] = useState<number | null>(null);

  const selected = projections.filter((p) => !off.has(p.accountId));

  const { minimums, withExtra, excluded, longest } = useMemo(() => {
    const mins: number[][] = [];
    const fast: number[][] = [];
    const skipped: string[] = [];
    let anyExtra = false;

    for (const projection of selected) {
      const base = convertedSeries(projection, false, rates);
      if (base === null) {
        skipped.push(projection.name);
        continue;
      }
      mins.push(base);
      if (projection.withExtra) anyExtra = true;
      fast.push(convertedSeries(projection, true, rates) ?? base);
    }

    const minimumsCombined = combine(mins);
    return {
      minimums: minimumsCombined,
      withExtra: anyExtra ? combine(fast) : null,
      excluded: skipped,
      longest: Math.max(1, minimumsCombined.total.length - 1),
    };
  }, [selected, rates]);

  // Defaults to the whole of the slowest debt, so nothing is hidden until
  // somebody chooses to narrow it.
  const span = Math.min(horizon ?? longest, longest);
  const shown = minimums.total.slice(0, span + 1);
  const shownFast = withExtra ? withExtra.total.slice(0, span + 1) : null;
  const peak = Math.max(1, ...shown, ...(shownFast ?? []));

  const colourFor = (index: number) => SERIES_COLOURS[index % SERIES_COLOURS.length];

  if (projections.length === 0) return null;

  return (
    <div style={{ paddingBottom: "0.8rem" }}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <div>
          <p className="stat-tile__label">Owed in total</p>
          <p className="stat-tile__value" style={{ fontSize: "1.1rem" }}>
            {rates ? formatCurrency(shown[0] ?? 0, rates.base) : "—"}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">Debt free</p>
          <p className="stat-tile__value" style={{ fontSize: "1.1rem" }}>
            {minimums.clearsAt != null ? monthLabel(minimums.clearsAt) : "—"}
          </p>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>{duration(minimums.clearsAt)} at minimums</p>
        </div>
        {/* Only where an extra payment has actually been entered: a "with
            extra" figure identical to the one beside it is noise. */}
        {withExtra && withExtra.clearsAt != null && minimums.clearsAt != null && withExtra.clearsAt < minimums.clearsAt && (
          <div>
            <p className="stat-tile__label">With your extra</p>
            <p className="stat-tile__value stat-tile__value--good" style={{ fontSize: "1.1rem" }}>
              {monthLabel(withExtra.clearsAt)}
            </p>
            <p style={{ fontSize: "0.7rem", color: "var(--good)", margin: 0 }}>
              {duration(minimums.clearsAt - withExtra.clearsAt)} sooner
            </p>
          </div>
        )}
      </div>

      {/* Which debts are in the total. Off rather than on, so the list reads
          as "everything, unless you say otherwise". */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {projections.map((projection, index) => {
          const isOn = !off.has(projection.accountId);
          return (
            <label
              key={projection.accountId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.76rem",
                opacity: isOn ? 1 : 0.45,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() =>
                  setOff((current) => {
                    const next = new Set(current);
                    if (next.has(projection.accountId)) next.delete(projection.accountId);
                    else next.add(projection.accountId);
                    return next;
                  })
                }
              />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: colourFor(index), flexShrink: 0 }} aria-hidden />
              {projection.name}
            </label>
          );
        })}
      </div>

      {selected.length === 0 ? (
        <p className="empty-state">Nothing selected.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height={CHART_HEIGHT} preserveAspectRatio="none">
            <line x1="0" y1={CHART_HEIGHT - 1} x2={CHART_WIDTH} y2={CHART_HEIGHT - 1} stroke="var(--gridline)" strokeWidth="1" />
            {shownFast && (
              <path d={curvePath(shownFast, span, peak)} fill="none" stroke="var(--good)" strokeWidth="2" strokeDasharray="4 3" />
            )}
            <path d={curvePath(shown, span, peak)} fill="none" stroke="var(--seq-450)" strokeWidth="2" />
          </svg>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)" }}>
            <span>{monthLabel(0)}</span>
            <span>{monthLabel(span)}</span>
          </div>

          {/* The horizon, not the plan. Moving it changes what is shown and
              never what is owed - it cannot make a debt clear sooner, and the
              figures above stay the real ones. */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.73rem", marginTop: "0.5rem" }}>
            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>Show</span>
            <input
              type="range"
              min={Math.min(6, longest)}
              max={longest}
              value={span}
              onChange={(e) => setHorizon(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="How far ahead to show"
            />
            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{duration(span)}</span>
          </label>
        </>
      )}

      {excluded.length > 0 && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
          Left out of the total: {excluded.join(", ")} — no exchange rate for {excluded.length === 1 ? "its" : "their"} currency,
          and adding it in at face value would make the total wrong rather than incomplete.
        </p>
      )}
    </div>
  );
}
