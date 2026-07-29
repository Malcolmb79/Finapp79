import { Landmark, LineChart, Scale, Sparkles } from "lucide-react";
import MonthlyPlan from "../components/MonthlyPlan.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useCallback, useEffect, useState } from "react";
import { api, type Account, type Transaction } from "../api/client.js";
import { accountTypeLabel, amountDrawn, facilityLabel, isBorrowing, accountTxSums } from "../utils/accountBalance.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { sumInBase, useFxRates } from "../utils/fx.js";
import DebtAdvisor from "../components/DebtAdvisor.js";
import DebtCharts from "../components/DebtCharts.js";
import StatTile from "../components/dashboard/StatTile.js";
import { monthsToPayoff } from "../utils/payoff.js";

/**
 * A borrowing account, as the planner shows it.
 *
 * These aren't editable here — the balance comes from the account and the
 * terms from its agreement, so the place to change either is the account. What
 * they add is that the payoff picture covers everything owed rather than only
 * what was typed in twice.
 */
function AccountDebtRow({ account, txSum }: { account: Account; txSum: number }) {
  const owed = amountDrawn(account, txSum);
  const payment = account.loan_monthly_payment ?? 0;
  const rate = account.loan_rate ?? 0;
  const months = owed > 0 && payment > 0 ? monthsToPayoff(owed, rate, payment) : null;

  const detail = [
    accountTypeLabel(account),
    account.loan_rate != null ? `${account.loan_rate.toFixed(2)}% a year` : null,
    payment > 0 ? `${formatCurrency(payment, account.currency)}/mo` : null,
    // The contract's own end date beats the computed one — it accounts for
    // fees and rounding the payoff formula here doesn't model.
    account.loan_end_date
      ? `ends ${account.loan_end_date}`
      : months === null
        ? null
        : months === 0
          ? "paid off"
          : `~${months} mo at this payment`,
    // An untouched facility is worth showing but isn't debt — the figure on
    // the right stays at zero and this says why it's listed at all.
    owed === 0 && account.overdraft_limit
      ? `${formatCurrency(account.overdraft_limit, account.currency)} ${facilityLabel(account)?.toLowerCase() ?? "facility"}, not drawn`
      : account.overdraft_limit
        ? `of ${formatCurrency(account.overdraft_limit, account.currency)}`
        : null,
  ].filter(Boolean);

  return (
    <div className="account-row" style={{ flexWrap: "wrap" }}>
      <div className="account-row__info">
        <div className="account-row__name">{account.name}</div>
        <div className="account-row__meta">{detail.join(" · ")}</div>
      </div>
      <span className="account-row__balance">{formatCurrency(owed, account.currency)}</span>
    </div>
  );
}

export default function DebtPlanner() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const refresh = useCallback(() => {
    api.listAccounts().then(setAccounts);
    api.listTransactions().then(setTransactions);
  }, []);

  useEffect(refresh, [refresh]);

  const rates = useFxRates("EUR");

  // Counted from the point each balance was set, so a hand-set figure
  // is an opening balance that transactions move rather than a frozen
  // number — see accountTxSums.
  const byAccount = accountTxSums(accounts, transactions);
  // Anything that is borrowing or could be: an overdrawn balance is debt
  // whatever the account is called, and an arranged facility belongs in the
  // picture even before it's drawn on. Account type isn't the test — a cheque
  // account £400 into its overdraft is as much a debt as a loan is.
  const borrowing = accounts
    .filter((a) => isBorrowing(a, byAccount.get(a.id) ?? 0))
    .sort((a, b) => amountDrawn(b, byAccount.get(b.id) ?? 0) - amountDrawn(a, byAccount.get(a.id) ?? 0));

  // Converted rather than added raw — these accounts span currencies, and a
  // total that sums GBP to ZAR is worse than no total.
  const { converted: drawnTotal, unconvertible } = sumInBase(
    borrowing.map((a) => ({ amount: amountDrawn(a, byAccount.get(a.id) ?? 0), currency: a.currency })),
    rates
  );
  const facilityTotal = sumInBase(
    borrowing.filter((a) => a.overdraft_limit).map((a) => ({ amount: a.overdraft_limit ?? 0, currency: a.currency })),
    rates
  ).converted;

  const widgets: WidgetSpec[] = [
    {
      id: "plan",
      title: "Monthly plan",
      icon: Scale,
      accentVar: "--accent-4",
      defaultWidth: 672,
      defaultHeight: 520,
      render: () => <MonthlyPlan />,
    },
    {
      id: "charts",
      title: "Each account, over time",
      icon: LineChart,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 520,
      render: () => (borrowing.length > 0 ? <DebtCharts accounts={borrowing} txSums={byAccount} /> : <p className="empty-state">Nothing borrowed.</p>),
    },
    {
      id: "advisor",
      title: "Ask about your debt",
      icon: Sparkles,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 480,
      render: () => (borrowing.length > 0 ? <DebtAdvisor /> : <p className="empty-state">Nothing borrowed to plan against.</p>),
    },
    {
      id: "borrowing",
      title: "Borrowing on your accounts",
      icon: Landmark,
      accentVar: "--accent-3",
      defaultWidth: 672,
      defaultHeight: 400,
      render: () =>
        borrowing.length === 0 ? (
          <p className="empty-state">
            Nothing borrowed. Anything overdrawn, or with an overdraft or credit limit set on the Accounts page, appears here.
          </p>
        ) : (
          <>
            {rates && (
              <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <StatTile label="Currently drawn" value={formatCurrency(drawnTotal, rates.base)} />
                <StatTile label="Total facilities" value={formatCurrency(facilityTotal, rates.base)} />
              </div>
            )}
            {unconvertible.length > 0 && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
                Left out of the totals — no exchange rate for {unconvertible.join(", ")}.
              </p>
            )}
            {borrowing.map((a) => (
              <AccountDebtRow key={a.id} account={a} txSum={byAccount.get(a.id) ?? 0} />
            ))}
          </>
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Debt Planner</h1>
          <p className="page-header__subtitle">
            Track balances and see payoff time at your minimum payment · hold a card to move or resize it
          </p>
        </div>
      </div>

      <WidgetCanvas storageKey="debtPlanner.layout.v1" widgets={widgets} />
    </div>
  );
}
