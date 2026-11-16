import { useMemo, useState } from "react";
import { downloadCsv, toCsv } from "../utils/toCsv.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { comparePayoff, termLabel, type Amortization } from "../utils/amortization.js";
import type { Account } from "../api/client.js";

/**
 * What paying a little extra actually does.
 *
 * The Debt Planner answers which debt to attack and in what order. This
 * answers the question underneath one loan: what is each payment made of, and
 * what would putting more in every month buy.
 *
 * It exists because the effect is wildly non-obvious in the direction that
 * costs money. Two hundred a month on a thirty-year mortgage at six and a half
 * feels like a rounding error against a payment of nineteen hundred; it is
 * nearly seven years and six figures of interest. Nobody has that intuition,
 * which is why it has to be shown rather than described — and why the schedule
 * every figure is summed from is printed underneath rather than trusted.
 */

export interface LoanPayoffProps {
  /** Loans already on file, so the figures need not be retyped to be modelled. */
  loans: { account: Account; balance: number }[];
  currency: string;
}

const BLANK = { name: "My loan", balance: 300000, rate: 6.5, years: 30, extra: 200 };

/** The two balance curves, which is the picture the numbers are trying to describe. */
function BalanceCurves({
  standard,
  accelerated,
  opening,
  money,
}: {
  standard: Amortization;
  accelerated: Amortization;
  /** What is owed before any payment. Every row's balance is already post-payment. */
  opening: number;
  money: (v: number) => string;
}) {
  const width = 620;
  const height = 150;
  const maxMonths = standard.months || 1;
  const maxBalance = opening || 1;
  const curve = (rows: Amortization["schedule"]) =>
    rows
      .map((row, i) => `${i === 0 ? "M" : "L"}${((row.number / maxMonths) * width).toFixed(1)},${(height - (row.balance / maxBalance) * height).toFixed(1)}`)
      .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height + 18}`} width="100%" height={height + 18} role="img" aria-label="Balance over time, with and without the extra payment">
      <path d={curve(standard.schedule)} fill="none" stroke="var(--critical)" strokeWidth={1.8} />
      <path d={curve(accelerated.schedule)} fill="none" stroke="var(--good)" strokeWidth={1.8} />
      <text x={0} y={height + 14} fontSize={9} fill="var(--text-muted)">
        {money(maxBalance)} owed
      </text>
      <text x={width} y={height + 14} textAnchor="end" fontSize={9} fill="var(--text-muted)">
        {termLabel(standard.months)}
      </text>
    </svg>
  );
}

export default function LoanPayoffModeller({ loans, currency }: LoanPayoffProps) {
  const [name, setName] = useState(BLANK.name);
  const [balance, setBalance] = useState(String(BLANK.balance));
  const [rate, setRate] = useState(String(BLANK.rate));
  const [years, setYears] = useState(String(BLANK.years));
  const [extra, setExtra] = useState(String(BLANK.extra));
  const [startMonth, setStartMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showAll, setShowAll] = useState(false);

  const money = (value: number) => formatCurrency(value, currency);
  const num = (value: string) => {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const terms = {
    balance: num(balance),
    annualRate: num(rate),
    termMonths: Math.round(num(years) * 12),
    extraMonthly: num(extra),
    startMonth,
  };

  const result = useMemo(
    () => comparePayoff(terms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terms.balance, terms.annualRate, terms.termMonths, terms.extraMonthly, terms.startMonth]
  );

  /** Fills the form from a loan already on file, rather than making it be retyped. */
  function loadLoan(accountId: string) {
    const found = loans.find((l) => l.account.id === accountId);
    if (!found) return;
    setName(found.account.name);
    setBalance(String(Math.round(Math.abs(found.balance))));
    if (found.account.loan_rate) setRate(String(found.account.loan_rate));
    if (found.account.loan_term_months) setYears((found.account.loan_term_months / 12).toFixed(1));
  }

  const { standard, accelerated, monthsSaved, interestSaved } = result;
  const impossible = standard.months === 0;
  const rows = showAll ? accelerated.schedule : accelerated.schedule.slice(0, 12);

  function exportSchedule() {
    downloadCsv(
      `amortization-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
      toCsv(
        ["#", "Month", "Payment", "Principal", "Interest", "Balance", "Interest to date"],
        accelerated.schedule.map((row) => [
          row.number,
          row.month ?? "",
          row.payment.toFixed(2),
          row.principal.toFixed(2),
          row.interest.toFixed(2),
          row.balance.toFixed(2),
          row.cumulativeInterest.toFixed(2),
        ])
      )
    );
  }

  return (
    <>
      <div className="loan-form">
        {loans.length > 0 && (
          <label>
            <span>Start from</span>
            <select defaultValue="" onChange={(e) => loadLoan(e.target.value)}>
              <option value="">A loan of your own…</option>
              {loans.map((l) => (
                <option key={l.account.id} value={l.account.id}>
                  {l.account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Label</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Balance owed</span>
          <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label>
          <span>Rate %</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label>
          <span>Term, years</span>
          <input inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
        <label>
          <span>Extra a month</span>
          <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </label>
        <label>
          <span>First payment</span>
          <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        </label>
      </div>

      {impossible ? (
        <p className="empty-state">
          At {num(rate)}% the interest on {money(num(balance))} is more than the payment this term implies, so the balance
          would grow rather than shrink. Check the rate or lengthen the term.
        </p>
      ) : (
        <>
          <div className="stat-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))", margin: "0.9rem 0" }}>
            <div>
              <p className="stat-tile__label">Monthly payment</p>
              <p className="stat-tile__value">{money(standard.monthlyPayment)}</p>
            </div>
            <div>
              <p className="stat-tile__label">With the extra</p>
              <p className="stat-tile__value">{money(accelerated.totalMonthly)}</p>
            </div>
            <div>
              <p className="stat-tile__label">Paid off in</p>
              <p className="stat-tile__value" style={{ color: monthsSaved > 0 ? "var(--good)" : undefined }}>
                {termLabel(accelerated.months)}
              </p>
            </div>
            <div>
              <p className="stat-tile__label">Interest, as contracted</p>
              <p className="stat-tile__value" style={{ color: "var(--critical)" }}>
                {money(standard.totalInterest)}
              </p>
            </div>
            <div>
              <p className="stat-tile__label">Interest saved</p>
              <p className="stat-tile__value" style={{ color: interestSaved > 0 ? "var(--good)" : undefined }}>
                {money(interestSaved)}
              </p>
            </div>
          </div>

          {/* The sentence the whole widget is for. Two figures in tiles invite
              comparison; one sentence makes the claim. */}
          {monthsSaved > 0 && (
            <p style={{ fontSize: "0.84rem", margin: "0 0 0.8rem", lineHeight: 1.5 }}>
              <strong>{money(num(extra))} a month extra</strong> clears this {termLabel(monthsSaved)} early and saves{" "}
              <strong>{money(interestSaved)}</strong> in interest — {((interestSaved / (standard.totalInterest || 1)) * 100).toFixed(0)}
              % of what the loan would otherwise cost you. Over the shortened term that extra adds up to{" "}
              {money(num(extra) * accelerated.months)}.
            </p>
          )}

          <BalanceCurves standard={standard} accelerated={accelerated} opening={terms.balance} money={money} />
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.2rem 0 1rem" }}>
            <span style={{ color: "var(--critical)" }}>━</span> as contracted ·{" "}
            <span style={{ color: "var(--good)" }}>━</span> with the extra
          </p>

          <div className="loan-schedule__header">
            <strong style={{ fontSize: "0.8rem" }}>Schedule</strong>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: "0.73rem", padding: "0.15rem 0.5rem" }}>
                {showAll ? "First year only" : `All ${accelerated.months} payments`}
              </button>
              <button onClick={exportSchedule} style={{ fontSize: "0.73rem", padding: "0.15rem 0.5rem" }}>
                CSV
              </button>
            </div>
          </div>

          {/* Printed rather than summarised. A payoff claim nobody can check
              row by row is the claim that gets doubted exactly when it is most
              useful. */}
          <div className="loan-schedule">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Month</th>
                  <th style={{ textAlign: "right" }}>Payment</th>
                  <th style={{ textAlign: "right" }}>Principal</th>
                  <th style={{ textAlign: "right" }}>Interest</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.number}>
                    <td>{row.number}</td>
                    <td>{row.month ?? "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.payment)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--good)" }}>
                      {money(row.principal)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--critical)" }}>
                      {money(row.interest)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
