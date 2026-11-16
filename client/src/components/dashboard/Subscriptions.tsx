import { ChevronLeft, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import type { RecurringPayment } from "../../utils/recurring.js";
import type { UnclaimedRepayment } from "../../utils/loanRepayments.js";
import type { Commitment } from "../../utils/commitments.js";
import { formatCurrency } from "../../utils/formatCurrency.js";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth.js";

/**
 * What the standing commitments cost, and what each one is.
 *
 * A subscription total answers a question a category breakdown can't: not
 * "what did I spend on entertainment" but "what am I signed up to". The two
 * differ most where it matters — a yearly insurance premium and a monthly
 * streaming bill sit in different categories, in different months, and are
 * the same kind of commitment.
 *
 * Everything is stated per month whatever the billing cadence, because that
 * is the only way a yearly charge and a weekly one can be added together or
 * compared.
 */

const CHART_HEIGHT = 110;
const MONTHS_SHOWN = 12;

const CADENCE_LABEL: Record<RecurringPayment["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/** The last N months, so a month with no charges is still a gap in the bars. */
function recentMonths(count: number): string[] {
  const months: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const month = new Date(cursor);
    month.setMonth(cursor.getMonth() - i);
    months.push(month.toISOString().slice(0, 7));
  }
  return months;
}

function Bars({ data, currency }: { data: { month: string; amount: number }[]; currency: string }) {
  const [ref, width] = useMeasuredWidth(420);
  const max = Math.max(1, ...data.map((d) => d.amount));
  const slot = data.length > 0 ? width / data.length : width;
  const barWidth = Math.max(2, Math.min(26, slot - 8));
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width / 56))));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {/* Drawn at its measured width rather than stretched, so the bars keep
          their shape and nothing inside is distorted by a resize. */}
      <svg width={width} height={CHART_HEIGHT} style={{ display: "block" }}>
        <line x1={0} x2={width} y1={CHART_HEIGHT - 1} y2={CHART_HEIGHT - 1} stroke="var(--gridline)" strokeWidth={1} />
        {data.map((d, i) => {
          const height = (d.amount / max) * (CHART_HEIGHT - 10);
          return (
            <rect
              key={d.month}
              x={i * slot + (slot - barWidth) / 2}
              y={CHART_HEIGHT - 1 - height}
              width={barWidth}
              height={height}
              rx={3}
              fill="var(--seq-450)"
            >
              <title>{`${monthLabel(d.month)}: ${formatCurrency(d.amount, currency)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
        {data.map((d, i) => (
          <span
            key={d.month}
            style={{
              width: slot,
              textAlign: "center",
              overflow: "hidden",
              whiteSpace: "nowrap",
              visibility: i % labelStep === 0 || i === data.length - 1 ? "visible" : "hidden",
            }}
          >
            {monthLabel(d.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Subscriptions({
  payments,
  currency,
  repayments = [],
  unclaimed = [],
  commitments = [],
  onAttribute,
}: {
  payments: RecurringPayment[];
  currency: string;
  /** Regular payments left out because they repay a loan — named, not hidden. */
  repayments?: RecurringPayment[];
  /** Loans nothing is repaying, beside a payment that looks like the repayment. */
  unclaimed?: UnclaimedRepayment[];
  /**
   * What each payment actually is. Insurance is spending like any other and
   * stays in every figure here — it only stops being called a subscription,
   * under a heading whose whole promise is "here is what you could stop
   * paying for".
   */
  commitments?: Commitment[];
  onAttribute?: (hit: UnclaimedRepayment) => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const money = (value: number) => formatCurrency(value, currency);
  const suggestionFor = (key: string) => unclaimed.find((hit) => hit.payment.key === key) ?? null;

  async function attribute(hit: UnclaimedRepayment) {
    if (!onAttribute) return;
    setAttaching(hit.payment.key);
    setFailed(null);
    try {
      await onAttribute(hit);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setAttaching(null);
    }
  }

  /**
   * What was left out, rather than a quietly smaller total.
   *
   * A repayment dropping off this list without a word is indistinguishable
   * from the detector having missed it, and the figure above can then never be
   * reconciled against the account it came from.
   */
  const excluded = repayments.length > 0 && (
    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
      {repayments.length === 1 ? "One loan repayment is" : `${repayments.length} loan repayments are`} not counted here —{" "}
      {money(repayments.reduce((sum, p) => sum + p.monthly, 0))} a month that buys down a balance rather than paying for
      something.
    </p>
  );

  if (payments.length === 0) {
    return (
      <div>
        <p className="empty-state">Nothing charging on a regular rhythm yet.</p>
        {excluded}
      </div>
    );
  }

  const selected = payments.find((p) => p.key === selectedKey) ?? null;
  const months = recentMonths(MONTHS_SHOWN);

  // What was actually charged in each month, not the smoothed monthly cost —
  // the point of the chart is to show the lumps a yearly renewal puts in one
  // month, which an average would hide.
  const chargesFor = (list: RecurringPayment[]) =>
    months.map((month) => ({
      month,
      amount: list
        .flatMap((p) => p.charges)
        .filter((c) => monthKey(c.date) === month)
        .reduce((sum, c) => sum + c.amount, 0),
    }));

  /**
   * The split, and which side of it the headline figure speaks for.
   *
   * The big number answers "what am I signed up to that I could stop", so it
   * counts subscriptions and not insurance — a premium quoted inside that
   * total is an invitation to cancel cover to save money, which is the one
   * conclusion this card must not lead anybody to. The premiums are still
   * here, still charted, still added up: under their own heading, where the
   * figure means something different.
   */
  const insuranceKeys = new Set(commitments.filter((c) => c.kind === "insurance").map((c) => c.payment.key));
  const insuranceReason = new Map(commitments.filter((c) => c.because).map((c) => [c.payment.key, c.because as string]));
  const subs = payments.filter((p) => !insuranceKeys.has(p.key));
  const insured = payments.filter((p) => insuranceKeys.has(p.key));
  const sum = (list: RecurringPayment[]) => list.reduce((total, p) => total + p.monthly, 0);
  const monthlyTotal = sum(subs);

  if (selected) {
    const history = [...selected.charges].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div>
        <button onClick={() => setSelectedKey(null)} style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}>
          <ChevronLeft size={13} /> All subscriptions
        </button>

        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
          <strong style={{ fontSize: "0.95rem" }}>{selected.label}</strong>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {CADENCE_LABEL[selected.cadence]} · {money(selected.amount)} each
          </span>
        </div>
        <p style={{ fontSize: "0.8rem", margin: "0 0 0.6rem" }}>
          <strong>{money(selected.monthly)}</strong> a month · {money(selected.annualised)} a year · {selected.occurrences} charges
          seen
        </p>

        <Bars data={chargesFor([selected])} currency={currency} />

        <table style={{ marginTop: "0.6rem" }}>
          <thead>
            <tr>
              <th>Charged</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {history.map((charge) => (
              <tr key={`${charge.date}-${charge.amount}`}>
                <td>{charge.date}</td>
                <td>{money(charge.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      {/* Zero subscriptions is a sentence, not a €0.00. Everything on a
          rhythm being insurance or a repayment is a real and perfectly
          ordinary answer, and printing it as a nil total reads as the
          detector having failed. */}
      {subs.length === 0 ? (
        <p style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
          Nothing here is a subscription — everything charging on a rhythm is insurance or a loan repayment, and neither is
          something to stop paying.
        </p>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <span className="stat-tile__value" style={{ fontSize: "1.5rem" }}>
            {money(monthlyTotal)}
          </span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            a month across {subs.length} {subs.length === 1 ? "subscription" : "subscriptions"} · {money(monthlyTotal * 12)} a
            year
          </span>
        </div>
      )}

      <Bars data={chargesFor(payments)} currency={currency} />

      {excluded}

      <div style={{ marginTop: "0.7rem" }}>
        {subs.map((p) => {
          const hit = suggestionFor(p.key);
          return (
            <div key={p.key} style={{ borderTop: "1px solid var(--gridline)" }}>
              {/* A row is the way in rather than a separate link: the whole
                  line is what you are pointing at when you want to know more
                  about it. */}
              <button
                onClick={() => setSelectedKey(p.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.6rem",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  padding: "0.45rem 0",
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                  {p.label}
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}> · {CADENCE_LABEL[p.cadence]}</span>
                </span>
                <span style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                  <strong>{money(p.monthly)}</strong>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>/mo</span>
                </span>
              </button>

              {/* Offered under the row it is about, and only ever offered.
                  Confirming it writes the ordinary repayment rule, which is
                  what moves the loan's balance as well as taking the payment
                  off this list — hiding the row alone would leave the loan
                  frozen, which is the worse of the two faults. */}
              {hit && (
                <div className="subs-claim">
                  <Link2 size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span>
                    Looks like the repayment for <strong>{hit.account.name}</strong>, which nothing is repaying.
                  </span>
                  <button type="button" onClick={() => attribute(hit)} disabled={attaching !== null || !onAttribute} className="subs-claim__yes">
                    {attaching === p.key ? <Loader2 size={11} className="spin" /> : "It is"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {failed && <div style={{ color: "var(--critical)", fontSize: "0.72rem", paddingTop: "0.3rem" }}>{failed}</div>}
      </div>

      {/* Insurance, under its own heading and its own total.
          Not hidden and not subtracted: the money is spent, unlike a loan
          repayment, so it belongs in every spending figure this app prints.
          What it is not is something you could stop paying for and be fine —
          cancelling Netflix costs you Netflix, cancelling cover costs you the
          cover. Each row says what it was read from, so a wrong reading can
          be seen and argued with rather than silently moving a figure. */}
      {insured.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div className="subs-section">
            <span>Insurance — not a subscription, and not something to cancel to save money</span>
            <strong>{money(sum(insured))}/mo</strong>
          </div>
          {insured.map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedKey(p.key)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.6rem",
                width: "100%",
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--gridline)",
                padding: "0.45rem 0",
                cursor: "pointer",
                font: "inherit",
                textAlign: "left",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                {p.label}
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                  {" · "}
                  {insuranceReason.get(p.key) ?? CADENCE_LABEL[p.cadence]}
                </span>
              </span>
              <span style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                <strong>{money(p.monthly)}</strong>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>/mo</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
