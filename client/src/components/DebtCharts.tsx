import { useEffect, useState } from "react";
import { api, type Account, type DebtProjection } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";

const TYPE_LABELS: Record<string, string> = {
  current: "Cheque account",
  savings: "Savings account",
  credit_card: "Credit card",
  loan: "Personal loan",
};

function accountTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "Account";
}

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

/** The month `offset` months from now, as "Mar 27". */
function monthLabel(offset: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function curvePath(series: number[], span: number, peak: number): string {
  return series
    .map((value, i) => {
      const x = span > 0 ? (i / span) * CHART_WIDTH : 0;
      const y = CHART_HEIGHT - PAD - (peak > 0 ? (value / peak) * (CHART_HEIGHT - PAD * 2) : 0);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function duration(count: number | null): string {
  if (count === null) return "never at this rate";
  if (count === 0) return "cleared";
  if (count < 24) return `${count} month${count === 1 ? "" : "s"}`;
  return `${Math.floor(count / 12)}y ${count % 12}m`;
}

/**
 * Dates under the curve.
 *
 * A line falling to zero says nothing without them — "when am I free of this"
 * is the question being asked, and the answer is a date rather than a shape.
 * Four evenly spaced ticks, which is as many as fit on a phone.
 */
function Axis({ span }: { span: number }) {
  const ticks = Array.from({ length: 4 }, (_, i) => Math.round((span / 3) * i));
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)" }}>
      {ticks.map((offset, i) => (
        <span key={`${offset}-${i}`}>{monthLabel(offset)}</span>
      ))}
    </div>
  );
}

function AccountChart({
  projection,
  account,
  extra,
  onExtraChange,
}: {
  projection: DebtProjection;
  account: Account | undefined;
  extra: string;
  onExtraChange: (value: string) => void;
}) {
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
  const tone =
    utilisation === null
      ? "var(--accent)"
      : utilisation >= 80
        ? "var(--critical)"
        : utilisation >= 50
          ? "var(--accent-3)"
          : "var(--accent)";

  const clearsIn = projection.minimums.months;
  const fasterClearsIn = projection.withExtra?.months ?? null;
  const saved =
    projection.withExtra && !projection.withExtra.neverClears && !projection.minimums.neverClears
      ? projection.minimums.totalInterest - projection.withExtra.totalInterest
      : null;

  return (
    <div style={{ padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.88rem" }}>{projection.name}</strong>
        <span style={{ fontSize: "0.85rem" }}>{formatCurrency(projection.balance, projection.currency)}</span>
      </div>

      <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0.15rem 0 0.4rem" }}>
        {/* An account with a facility it hasn't touched still belongs here —
            it is listed as borrowing on the page above, and leaving it out of
            the charts reads as something missing. But there is no payoff to
            describe, so it says that instead of drawing a flat line. */}
        {projection.balance <= 0
          ? // Two different situations that both read as zero, and they call
            // for different things: an untouched facility is fine as it is,
            // a card with no balance recorded is missing a figure only the
            // user can supply.
            (account?.overdraft_limit ?? 0) > 0
            ? `${accountTypeLabel(projection.accountType)} · nothing drawn`
            : `${accountTypeLabel(projection.accountType)} · no balance recorded — set what's owed on the Accounts page`
          : [
              projection.rate > 0 ? `${projection.rate}% a year` : "no rate recorded",
              projection.minimumIsAssumed
                ? `${formatCurrency(projection.minimumPayment, projection.currency)}/mo assumed`
                : `${formatCurrency(projection.minimumPayment, projection.currency)}/mo`,
              // The date as well as the count: a duration on its own still
              // leaves you counting forward on your fingers.
              projection.minimums.neverClears
                ? "never clears at this payment"
                : `clear by ${monthLabel(clearsIn ?? 0)} · ${duration(clearsIn)}`,
            ].join(" · ")}
      </p>

      {span > 0 && (
        <>
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
          <Axis span={span} />
        </>
      )}

      {projection.balance > 0 && (
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.73rem", color: "var(--text-muted)" }} htmlFor={`extra-${projection.accountId}`}>
          Extra per month
        </label>
        <input
          id={`extra-${projection.accountId}`}
          inputMode="decimal"
          value={extra}
          onChange={(e) => onExtraChange(e.target.value)}
          placeholder="0"
          style={{ width: 90, fontSize: "0.8rem", padding: "0.25rem 0.4rem" }}
        />
        {projection.withExtra && (
          <span style={{ fontSize: "0.73rem", color: "var(--good)" }}>
            {projection.withExtra.neverClears
              ? "still never clears"
              : `clear by ${monthLabel(fasterClearsIn ?? 0)} · ${duration(fasterClearsIn)}`}
            {saved !== null && saved > 0 ? ` · ${formatCurrency(saved, projection.currency)} less interest` : ""}
          </span>
        )}
      </div>
      )}

      {/* A curve drawn from a stand-in payment is the one most worth
          doubting, so it says so rather than looking like the agreement. */}
      {projection.minimumIsAssumed && projection.balance > 0 && (
        <p style={{ fontSize: "0.71rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
          No payment imported yet, so this assumes {formatCurrency(projection.minimumPayment, projection.currency)} a month —{" "}
          {projection.accountType === "credit_card" ? (
            <>
              {/* Naming the euro standard makes the local figure legible as a
                  conversion rather than an arbitrary number. */}
              the standard {projection.currency === "EUR" ? "€300" : "€300, converted"}. Import a statement or the agreement to
              replace it.
            </>
          ) : (
            <>
              {/* The likeliest reason a card shows an odd figure: it is still
                  typed as something else, so it never reaches the card rule. */}
              1% of the balance, which is the assumption for a{" "}
              {projection.accountType === "loan" ? "loan" : projection.accountType === "savings" ? "savings account" : "cheque account"}
              . If this is a credit card, set its type on the Accounts page and it will use the standard €300 instead.
            </>
          )}
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
  // Held as typed rather than as numbers, so a half-entered "2" of "250"
  // isn't read as two hundred and fifty short of what's meant.
  const [extras, setExtras] = useState<Record<string, string>>({});

  useEffect(() => {
    const parsed: Record<string, number> = {};
    for (const [id, value] of Object.entries(extras)) {
      const amount = Number(value.replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) parsed[id] = amount;
    }

    let cancelled = false;
    // Debounced, since typing "250" would otherwise re-simulate three times.
    const timer = setTimeout(() => {
      api
        .debtProjection(parsed)
        .then((result) => !cancelled && setProjections(result))
        .catch(() => !cancelled && setProjections([]));
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [extras]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div className="card__header">
        <h2 className="card__title">Each account, over time</h2>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          Every account on its own payments. Add an extra monthly amount to any of them to see what it buys.
        </p>
      </div>

      {projections === null && <p className="empty-state">Working it out…</p>}
      {projections?.length === 0 && <p className="empty-state">Nothing owed to chart.</p>}
      {projections?.map((p) => (
        <AccountChart
          key={p.accountId}
          projection={p}
          account={accountsById.get(p.accountId)}
          extra={extras[p.accountId] ?? ""}
          onExtraChange={(value) => setExtras((current) => ({ ...current, [p.accountId]: value }))}
        />
      ))}
    </div>
  );
}
