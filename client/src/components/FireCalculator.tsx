import { useMemo, useState } from "react";
import { formatCurrency } from "../utils/formatCurrency.js";
import {
  coastsBy,
  coastValue,
  DEFAULT_REAL_RETURN,
  DEFAULT_WITHDRAWAL_RATE,
  fireDate,
  fireTimeline,
  projectFire,
} from "../utils/fire.js";

/**
 * When work could become optional.
 *
 * Two assumptions do all the work here, and both are exposed as controls
 * rather than buried, because a single number with hidden assumptions is a
 * prophecy and two numbers with visible ones is a comparison. Nobody should
 * take a date from this; they should take the *difference* a decision makes
 * to it.
 *
 * The pot is investable assets only — what the statement calls liquid plus the
 * investment portfolio. Not the house, which is the one exclusion worth
 * repeating on screen, because including it is the single most common way
 * these calculators flatter their owner.
 */

export interface FireProps {
  investable: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  currency: string;
}

/** The pot drawn as a curve against the line it has to cross. */
function FirePath({ path, target, money }: { path: { year: number; value: number }[]; target: number; money: (v: number) => string }) {
  if (path.length < 2) return null;
  const width = 560;
  const height = 120;
  const maxValue = Math.max(target, ...path.map((p) => p.value));
  const maxYear = path[path.length - 1].year || 1;
  const x = (year: number) => (year / maxYear) * width;
  const y = (value: number) => height - (value / maxValue) * height;

  const line = path.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const targetY = y(target);

  return (
    <svg viewBox={`0 0 ${width} ${height + 16}`} width="100%" height={height + 16} role="img" aria-label="Projected pot against the target">
      <line x1={0} x2={width} y1={targetY} y2={targetY} stroke="var(--accent-3)" strokeWidth={1} strokeDasharray="4 3" />
      <text x={width} y={Math.max(9, targetY - 4)} textAnchor="end" fontSize={9} fill="var(--accent-3)">
        {money(target)}
      </text>
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <text x={0} y={height + 12} fontSize={9} fill="var(--text-muted)">
        now
      </text>
      <text x={width} y={height + 12} textAnchor="end" fontSize={9} fill="var(--text-muted)">
        {/* Rounded up to the whole year. The raw value is a count of months
            over twelve, and an axis reading "17.083333333333332 years" is the
            arithmetic leaking through the label. */}
        {Math.ceil(maxYear)} years
      </text>
    </svg>
  );
}

export default function FireCalculator({ investable, monthlyIncome, monthlyExpenses, currency }: FireProps) {
  const [withdrawalRate, setWithdrawalRate] = useState(DEFAULT_WITHDRAWAL_RATE);
  const [realReturn, setRealReturn] = useState(DEFAULT_REAL_RETURN);
  const money = (value: number) => formatCurrency(value, currency);

  const monthlySaving = monthlyIncome - monthlyExpenses;
  const annualExpenses = monthlyExpenses * 12;

  const result = useMemo(
    () => projectFire({ investable, monthlySaving, annualExpenses, realReturn, withdrawalRate }),
    [investable, monthlySaving, annualExpenses, realReturn, withdrawalRate]
  );

  const coast = useMemo(
    () => coastsBy({ investable, monthlySaving: 0, annualExpenses, realReturn, withdrawalRate }, 40),
    [investable, annualExpenses, realReturn, withdrawalRate]
  );

  const landing = fireDate(result);
  const progress = Math.max(0, Math.min(100, result.progress * 100));

  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8.5rem, 1fr))", marginBottom: "0.85rem" }}>
        <div>
          <p className="stat-tile__label">Your number</p>
          <p className="stat-tile__value">{result.target > 0 ? money(result.target) : "—"}</p>
        </div>
        <div>
          <p className="stat-tile__label">Invested today</p>
          <p className="stat-tile__value">{money(investable)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Time to get there</p>
          <p className="stat-tile__value" style={{ color: result.months === null ? "var(--critical)" : undefined }}>
            {fireTimeline(result)}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">{landing ? "Lands around" : "Saving a month"}</p>
          <p className="stat-tile__value">
            {landing
              ? new Date(`${landing}-01T00:00:00Z`).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })
              : money(monthlySaving)}
          </p>
        </div>
      </div>

      <div className="budget-row__track" style={{ marginBottom: "0.3rem" }}>
        <div className="budget-row__fill" data-status={progress >= 100 ? "good" : "warning"} style={{ width: `${progress}%` }} />
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", margin: "0 0 0.9rem" }}>
        {progress.toFixed(1)}% of the way there · {money(Math.max(0, result.target - investable))} still to find
      </p>

      {result.path.length > 1 && <FirePath path={result.path} target={result.target} money={money} />}

      {/* Both assumptions are controls rather than constants. The figure above
          is only as good as these two, and a reader who cannot see them has no
          way to disagree with it. */}
      <div style={{ display: "grid", gap: "0.55rem", margin: "0.9rem 0 0" }}>
        <label style={{ fontSize: "0.78rem", display: "grid", gap: "0.2rem" }}>
          <span>
            Withdrawal rate <strong>{(withdrawalRate * 100).toFixed(1)}%</strong> — a pot of{" "}
            {(1 / withdrawalRate).toFixed(0)}× what you spend in a year
          </span>
          <input
            type="range"
            min={0.025}
            max={0.06}
            step={0.0025}
            value={withdrawalRate}
            onChange={(e) => setWithdrawalRate(Number(e.target.value))}
            aria-label="Safe withdrawal rate"
          />
        </label>
        <label style={{ fontSize: "0.78rem", display: "grid", gap: "0.2rem" }}>
          <span>
            Return after inflation <strong>{(realReturn * 100).toFixed(1)}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={0.1}
            step={0.005}
            value={realReturn}
            onChange={(e) => setRealReturn(Number(e.target.value))}
            aria-label="Real return after inflation"
          />
        </label>
      </div>

      <p style={{ fontSize: "0.76rem", margin: "0.85rem 0 0", lineHeight: 1.5 }}>
        {coast === 0 ? (
          <>
            <strong>You could stop saving now.</strong> What is already invested covers the number at this withdrawal rate.
          </>
        ) : coast !== null ? (
          <>
            <strong>Coasting point:</strong> if you never added another euro, what is already invested would grow into the
            number in about {coast} years — {money(coastValue(investable, coast, realReturn))}. Everything you save from here
            buys an earlier date rather than the outcome itself.
          </>
        ) : (
          <>
            <strong>Not coasting yet.</strong> What is invested today would not grow into the number on its own within forty
            years, so the saving is still doing the work.
          </>
        )}
      </p>

      <ul className="report__notes" style={{ marginTop: "0.7rem" }}>
        <li>
          The pot is what you could actually draw on — cash, savings and investments. A home you live in is left out: it does
          not pay for groceries unless you sell it and move.
        </li>
        <li>
          Everything is in today&apos;s money. The return is after inflation, which is why the target is not inflated to
          match.
        </li>
        <li>
          Income and spending are your own averages over the last 12 months. A projection is a sentence beginning &ldquo;if
          these numbers hold&rdquo;, and they will not — use it to compare decisions, not to book a date.
        </li>
      </ul>
    </>
  );
}
