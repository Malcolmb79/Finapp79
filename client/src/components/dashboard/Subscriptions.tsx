import { ChevronLeft, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import type { RecurringPayment } from "../../utils/recurring.js";
import type { UnclaimedRepayment } from "../../utils/loanRepayments.js";
import type { Category } from "../../api/client.js";
import { groupCommitments, sharedToken, UNFILED, type Commitment } from "../../utils/commitments.js";
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
  categories = [],
  onAttribute,
  onFile,
}: {
  payments: RecurringPayment[];
  currency: string;
  /** Regular payments left out because they repay a loan — named, not hidden. */
  repayments?: RecurringPayment[];
  /** Loans nothing is repaying, beside a payment that looks like the repayment. */
  unclaimed?: UnclaimedRepayment[];
  /**
   * What each payment actually is, in the owner's own words. Everything here
   * is spending and stays in every figure — the kinds only stop a phone bill
   * and a life policy being called subscriptions.
   */
  commitments?: Commitment[];
  /** Offered for filing a payment nobody has said anything about yet. */
  categories?: Category[];
  onAttribute?: (hit: UnclaimedRepayment) => Promise<void>;
  /** Files this merchant under a category, now and from now on. */
  onFile?: (payment: RecurringPayment, categoryId: number, matchText: string) => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
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

  async function file(payment: RecurringPayment, categoryId: number, matchText: string) {
    if (!onFile) return;
    setFiling(payment.key);
    setFailed(null);
    try {
      await onFile(payment, categoryId, matchText);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not file that.");
    } finally {
      setFiling(null);
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
   * The headline speaks for every commitment on the card, and the sections
   * say what each kind of it is.
   *
   * It used to say "€528.59 a month across 8 subscriptions" over a list whose
   * largest three entries were a personal loan, a life policy and a phone
   * bill. The figure was right and the sentence was wrong, and a wrong
   * sentence over a right figure is the more convincing of the two.
   */
  const groups = groupCommitments(commitments.length > 0 ? commitments : payments.map(fallbackCommitment));
  const monthlyTotal = groups.reduce((total, group) => total + group.monthly, 0);

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
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <span className="stat-tile__value" style={{ fontSize: "1.5rem" }}>
          {money(monthlyTotal)}
        </span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          a month across {payments.length} {payments.length === 1 ? "commitment" : "commitments"} ·{" "}
          {money(monthlyTotal * 12)} a year
        </span>
      </div>

      <Bars data={chargesFor(payments)} currency={currency} />

      {excluded}

      {/* A section per kind, named in the owner's own words, each carrying its
          own total — so no figure on the card is ever read as speaking for a
          kind it does not cover. There is no list of merchants behind these
          headings and there should never be one: "Utilities" appears because
          somebody typed "Utilities". */}
      {groups.map((group) => (
        <div key={group.name} style={{ marginTop: "0.8rem" }}>
          <div className="subs-section">
            <span>
              {group.name}
              {group.name === UNFILED && (
                <span>
                  {" — "}
                  {group.commitments.length === 1 ? "this one has" : "these have"} no category, so nothing here can say
                  what {group.commitments.length === 1 ? "it is" : "they are"}
                </span>
              )}
            </span>
            <strong>{money(group.monthly)}/mo</strong>
          </div>

          {group.commitments.map(({ payment: p, readFrom }) => {
            const hit = suggestionFor(p.key);
            const token = group.name === UNFILED ? sharedToken(p) : null;
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
                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                      {" · "}
                      {/* Named when the grouping was read rather than filed, so
                          a reading can be seen and argued with. */}
                      {readFrom ?? CADENCE_LABEL[p.cadence]}
                    </span>
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
                    <button
                      type="button"
                      onClick={() => attribute(hit)}
                      disabled={attaching !== null || !onAttribute}
                      className="subs-claim__yes"
                    >
                      {attaching === p.key ? <Loader2 size={11} className="spin" /> : "It is"}
                    </button>
                  </div>
                )}

                {/* The answer offered from where the question is visible. A
                    heading that only says "nothing has said what these are" is
                    a scold; filing from here writes the ordinary rule, so it
                    holds for every future charge and every past one too.

                    Nothing is offered without a token present in every one of
                    this merchant's own descriptions — a rule whose text was
                    invented would file transactions nobody looked at. */}
                {!hit && token && onFile && categories.length > 0 && (
                  <div className="subs-claim">
                    <span>File as</span>
                    <select
                      aria-label={`Category for ${p.label}`}
                      value=""
                      disabled={filing !== null}
                      onChange={(e) => e.target.value && file(p, Number(e.target.value), token)}
                      style={{ fontSize: "0.72rem" }}
                    >
                      <option value="">Choose…</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    {filing === p.key ? (
                      <Loader2 size={11} className="spin" />
                    ) : (
                      <span>
                        and everything matching “{token}”
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {failed && <div style={{ color: "var(--critical)", fontSize: "0.72rem", paddingTop: "0.3rem" }}>{failed}</div>}
    </div>
  );
}

/**
 * What a payment is when nobody has passed a classification in.
 *
 * Keeps the card working on its own — in a test, or from a caller that has no
 * categories to hand — rather than making the grouping a required prop and
 * the card unusable without one.
 */
function fallbackCommitment(payment: RecurringPayment): Commitment {
  return { payment, categoryId: null, group: UNFILED, readFrom: null };
}
