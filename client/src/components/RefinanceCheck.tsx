import { useMemo, useState } from "react";
import { formatCurrency } from "../utils/formatCurrency.js";
import { compareRefinance, termLabel } from "../utils/amortization.js";
import type { Account } from "../api/client.js";

/**
 * Is the offer actually better?
 *
 * A refinance is advertised on the monthly payment and paid for in total
 * interest, and a longer term moves those two in opposite directions. Somebody
 * twenty years into a mortgage, offered a lower rate over a fresh thirty, is
 * shown a smaller number and handed a larger bill — and the smaller number is
 * the one on the letter.
 *
 * So both figures sit side by side, the fees are inside the net, and the case
 * where the payment falls while the total rises says so in words rather than
 * being left for the reader to spot in two columns.
 */

export interface RefinanceProps {
  loans: { account: Account; balance: number }[];
  currency: string;
}

export default function RefinanceCheck({ loans, currency }: RefinanceProps) {
  const [balance, setBalance] = useState("180000");
  const [rate, setRate] = useState("6.5");
  const [years, setYears] = useState("10");
  const [newRate, setNewRate] = useState("4.5");
  const [newYears, setNewYears] = useState("10");
  const [fees, setFees] = useState("2000");

  const money = (value: number) => formatCurrency(value, currency);
  const num = (value: string) => {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const result = useMemo(
    () =>
      compareRefinance(
        { balance: num(balance), annualRate: num(rate), termMonths: Math.round(num(years) * 12) },
        { annualRate: num(newRate), termMonths: Math.round(num(newYears) * 12), fees: num(fees) }
      ),
    [balance, rate, years, newRate, newYears, fees]
  );

  function loadLoan(accountId: string) {
    const found = loans.find((l) => l.account.id === accountId);
    if (!found) return;
    setBalance(String(Math.round(Math.abs(found.balance))));
    if (found.account.loan_rate) setRate(String(found.account.loan_rate));
    if (found.account.loan_term_months) {
      const term = (found.account.loan_term_months / 12).toFixed(1);
      setYears(term);
      setNewYears(term);
    }
  }

  const { current, offer, monthlySaving, interestSaved, netSaving, breakEvenMonths, cheaperButCostlier } = result;
  const unusable = current.months === 0 || offer.months === 0;

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
          <span>Balance owed</span>
          <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label>
          <span>Rate now %</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label>
          <span>Years left</span>
          <input inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
        <label>
          <span>Offered rate %</span>
          <input inputMode="decimal" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
        </label>
        <label>
          <span>Offered term, yrs</span>
          <input inputMode="decimal" value={newYears} onChange={(e) => setNewYears(e.target.value)} />
        </label>
        <label>
          <span>Cost to switch</span>
          <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
        </label>
      </div>

      {unusable ? (
        <p className="empty-state">
          One of these sets of terms never clears the balance — check the rates and the terms.
        </p>
      ) : (
        <>
          <table className="report__table" style={{ margin: "0.9rem 0 0.6rem" }}>
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Now</th>
                <th style={{ textAlign: "right" }}>Offered</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Monthly payment</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(current.monthlyPayment)}</td>
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: monthlySaving > 0 ? "var(--good)" : monthlySaving < 0 ? "var(--critical)" : undefined,
                  }}
                >
                  {money(offer.monthlyPayment)}
                </td>
              </tr>
              <tr>
                <td>Term</td>
                <td style={{ textAlign: "right" }}>{termLabel(current.months)}</td>
                <td style={{ textAlign: "right" }}>{termLabel(offer.months)}</td>
              </tr>
              <tr>
                <td>Interest over the life</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(current.totalInterest)}</td>
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: interestSaved > 0 ? "var(--good)" : "var(--critical)",
                  }}
                >
                  {money(offer.totalInterest)}
                </td>
              </tr>
              <tr data-kind="total">
                <td>What switching is worth</td>
                <td style={{ textAlign: "right" }} colSpan={2}>
                  <span style={{ color: netSaving >= 0 ? "var(--good)" : "var(--critical)" }}>
                    {netSaving >= 0 ? money(netSaving) : `−${money(Math.abs(netSaving))}`}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* The sentence, because two columns of figures is a comparison and
              this is a conclusion. */}
          {cheaperButCostlier ? (
            <p style={{ fontSize: "0.82rem", lineHeight: 1.5, color: "var(--warning)", margin: 0 }}>
              <strong>Smaller payment, bigger bill.</strong> You&apos;d pay {money(monthlySaving)} less each month and{" "}
              {money(Math.abs(interestSaved))} more in interest over the life of it, because the term goes from{" "}
              {termLabel(current.months)} back out to {termLabel(offer.months)}. That can still be the right call if the
              monthly figure is what&apos;s tight — but it is a cost, not a saving.
            </p>
          ) : netSaving > 0 ? (
            <p style={{ fontSize: "0.82rem", lineHeight: 1.5, margin: 0 }}>
              <strong>Worth doing on these numbers.</strong> {money(monthlySaving)} less a month and{" "}
              {money(interestSaved)} less interest, against {money(num(fees))} to switch —
              {breakEvenMonths === 0
                ? " nothing to recover, so it pays from the first payment."
                : ` the fees are back after ${breakEvenMonths} month${breakEvenMonths === 1 ? "" : "s"}.`}
            </p>
          ) : (
            <p style={{ fontSize: "0.82rem", lineHeight: 1.5, color: "var(--critical)", margin: 0 }}>
              <strong>Not on these numbers.</strong> Switching costs {money(Math.abs(netSaving))} more over the life of the
              loan once the {money(num(fees))} to switch is counted.
            </p>
          )}
        </>
      )}
    </>
  );
}
