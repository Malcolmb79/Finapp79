import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type Budget, type Category, type Transaction } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { limitNote, limitReality, type LimitCheck, type Verdict } from "../utils/limitReality.js";

/**
 * The caps against what the months actually came to.
 *
 * Every other budget view on this page answers "how is this month going".
 * This one answers the question underneath it — whether the caps themselves
 * are still the right numbers — which nothing asked, because a limit is set
 * once and then only ever judged by whether this month beat it.
 *
 * Two headline figures do most of the work: what the caps add up to, and what
 * the months actually came to. A household whose caps total 1,400 against
 * 2,100 spent is not overspending by a little every month; it is budgeting
 * against a number it made up, and no amount of discipline closes that gap.
 *
 * Nothing is applied on its own. Each row offers a figure and a button, the
 * same way the adviser's proposals do.
 */

const LABEL: Record<Verdict, string> = {
  "too-tight": "Too tight",
  "too-loose": "Too loose",
  "about-right": "Working",
  unbudgeted: "No limit",
  unproven: "Untested",
};

const COLOUR: Record<Verdict, string> = {
  "too-tight": "var(--critical)",
  "too-loose": "var(--warning)",
  "about-right": "var(--good)",
  unbudgeted: "var(--accent-2)",
  unproven: "var(--text-muted)",
};

/**
 * Six months as six bars with the cap drawn across them.
 *
 * A sentence saying "over in six of the last six months" is checkable; a
 * picture of it is immediate. The cap is a line rather than a bar because it
 * is a different kind of thing from a month's spending — one is a decision,
 * the others are facts.
 */
function MonthBars({ check }: { check: LimitCheck }) {
  const amounts = check.months.map((m) => m.amount);
  const ceiling = Math.max(check.limit ?? 0, ...amounts, 1);
  const width = 108;
  const height = 30;
  const gap = 3;
  const barWidth = (width - gap * (amounts.length - 1)) / amounts.length;
  const limitY = check.limit === null ? null : height - (check.limit / ceiling) * height;

  return (
    <svg width={width} height={height} role="img" aria-label={`Monthly spending for ${check.category_name}`} style={{ flexShrink: 0 }}>
      {check.months.map((m, i) => {
        const barHeight = Math.max(m.amount > 0 ? 1 : 0, (m.amount / ceiling) * height);
        const over = check.limit !== null && m.amount > check.limit;
        return (
          <rect
            key={m.month}
            x={i * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1.5}
            fill={over ? "var(--critical)" : "var(--seq-250)"}
          >
            <title>{`${m.month}: ${m.amount}`}</title>
          </rect>
        );
      })}
      {limitY !== null && (
        <line x1={0} x2={width} y1={limitY} y2={limitY} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="3 2" />
      )}
    </svg>
  );
}

export default function LimitReality({
  budgets,
  transactions,
  categories,
  currency,
  onChanged,
}: {
  budgets: Budget[];
  transactions: Transaction[];
  categories: Category[];
  currency: string;
  onChanged: () => void;
}) {
  const [applying, setApplying] = useState<number | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [showWorking, setShowWorking] = useState(false);
  const money = (value: number) => formatCurrency(value, currency);

  const checks = useMemo(
    () => limitReality(budgets, transactions, categories, currency),
    [budgets, transactions, categories, currency]
  );

  // The two figures the whole widget exists to put side by side. Caps counted
  // across the categories that have one; spending across every category in
  // the list, capped or not, because money going out of an uncapped category
  // is still money going out.
  //
  // Spending is each category spread across the months rather than its median
  // one: a sum of medians treats everything bought occasionally as costing
  // nothing, so the total it produces is lower than any month ever was.
  const cappedTotal = checks.reduce((sum, c) => sum + (c.limit ?? 0), 0);
  const actualTotal = checks.reduce((sum, c) => sum + c.monthly, 0);
  const wrong = checks.filter((c) => c.verdict === "too-tight" || c.verdict === "too-loose" || c.verdict === "unbudgeted");
  const working = checks.filter((c) => c.verdict === "about-right" || c.verdict === "unproven");

  async function apply(check: LimitCheck) {
    if (check.suggested === null) return;
    setApplying(check.category_id);
    try {
      await api.setBudget(check.category_id, check.suggested, currency);
      setApplied((current) => new Set(current).add(check.category_id));
      onChanged();
    } finally {
      setApplying(null);
    }
  }

  if (checks.length === 0) {
    return <p className="empty-state">No {currency} budgets or spending in the six months behind this one.</p>;
  }

  function row(check: LimitCheck) {
    const done = applied.has(check.category_id);
    return (
      <div key={check.category_id} style={{ borderTop: "1px solid var(--gridline)", paddingTop: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
          <MonthBars check={check} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.45rem", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.86rem" }}>{check.category_name}</strong>
              <span
                style={{
                  fontSize: "0.68rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: COLOUR[check.verdict],
                  fontWeight: 600,
                }}
              >
                {LABEL[check.verdict]}
              </span>
              {check.limit !== null && (
                <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>cap {money(check.limit)}</span>
              )}
            </div>

            <p style={{ fontSize: "0.78rem", margin: "0.15rem 0 0.3rem", lineHeight: 1.4 }}>{limitNote(check, money)}</p>

            {check.suggested !== null && (
              <button onClick={() => apply(check)} disabled={done || applying === check.category_id} style={{ fontSize: "0.75rem" }}>
                {done ? (
                  <>
                    <Check size={12} /> Set
                  </>
                ) : applying === check.category_id ? (
                  "Setting…"
                ) : check.limit === null ? (
                  `Budget ${money(check.suggested)}`
                ) : (
                  `Change to ${money(check.suggested)}`
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "0.7rem" }}>
        <div className="stat-tile">
          <p className="stat-tile__label">Your limits add up to</p>
          <p className="stat-tile__value" style={{ fontSize: "1.1rem" }}>
            {money(cappedTotal)}
          </p>
        </div>
        <div className="stat-tile">
          <p className="stat-tile__label">A typical month costs</p>
          <p
            className="stat-tile__value"
            style={{ fontSize: "1.1rem", color: actualTotal > cappedTotal ? "var(--critical)" : "var(--good)" }}
          >
            {money(actualTotal)}
          </p>
        </div>
      </div>

      {/* The gap stated rather than left to be read off two tiles. A gap this
          size is not a discipline problem, and calling it one is how a budget
          gets abandoned instead of corrected. */}
      {actualTotal > cappedTotal && (
        <p style={{ fontSize: "0.78rem", margin: "0 0 0.6rem", lineHeight: 1.45 }}>
          {money(actualTotal - cappedTotal)} a month goes out beyond what the limits allow for. Raising the caps below to what
          these categories actually cost makes the budget describe your spending — which is the only version of it you can hold
          yourself to.
        </p>
      )}

      {wrong.length === 0 ? (
        <p className="empty-state">Every limit matches what the months actually came to.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>{wrong.map(row)}</div>
      )}

      {working.length > 0 && (
        <>
          {/* Folded rather than dropped. A list that only ever accuses is one
              nobody opens twice, and "these ones are fine" is the part that
              makes the rest believable. */}
          <button
            onClick={() => setShowWorking((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: "0.5rem 0 0",
              cursor: "pointer",
              fontSize: "0.76rem",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            {showWorking ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {working.length} limit{working.length === 1 ? "" : "s"} not worth changing
          </button>
          {showWorking && <div style={{ display: "grid", gap: "0.5rem" }}>{working.map(row)}</div>}
        </>
      )}
    </>
  );
}
