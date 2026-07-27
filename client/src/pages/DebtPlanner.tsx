import { useCallback, useEffect, useState } from "react";
import { api, type Account, type Debt, type Transaction } from "../api/client.js";
import { accountBalance, isLiability } from "../utils/accountBalance.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import StatTile from "../components/dashboard/StatTile.js";
import { monthsToPayoff } from "../utils/payoff.js";

function DebtRow({ debt, onChanged }: { debt: Debt; onChanged: () => void }) {
  const [payment, setPayment] = useState("");
  const months = monthsToPayoff(debt.balance, debt.apr, debt.minimum_payment);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(payment);
    if (!amount || amount <= 0) return;
    await api.updateDebt(debt.id, { balance: Math.max(0, debt.balance - amount) });
    setPayment("");
    onChanged();
  }

  async function handleDelete() {
    await api.deleteDebt(debt.id);
    onChanged();
  }

  return (
    <div className="account-row" style={{ flexWrap: "wrap" }}>
      <div className="account-row__info">
        <div className="account-row__name">{debt.name}</div>
        <div className="account-row__meta">
          {debt.apr.toFixed(2)}% APR · min {debt.minimum_payment.toFixed(2)}/mo ·{" "}
          {months === null ? "won't pay off at minimum payment" : months === 0 ? "paid off" : `~${months} mo at minimum`}
        </div>
      </div>
      <span className="account-row__balance">{debt.balance.toFixed(2)}</span>
      <form onSubmit={handlePay} style={{ display: "flex", gap: "0.4rem" }}>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Payment"
          value={payment}
          onChange={(e) => setPayment(e.target.value)}
          style={{ width: 100 }}
        />
        <button type="submit">Pay</button>
        <button type="button" onClick={handleDelete}>
          Remove
        </button>
      </form>
    </div>
  );
}

/**
 * A borrowing account shown alongside the hand-entered debts.
 *
 * These aren't editable here — the balance comes from the account and the
 * terms from its agreement, so the place to change either is the account. What
 * they add is that the payoff picture covers everything owed rather than only
 * what was typed in twice.
 */
function AccountDebtRow({ account, txSum }: { account: Account; txSum: number }) {
  const owed = -accountBalance(account, txSum);
  const payment = account.loan_monthly_payment ?? 0;
  const rate = account.loan_rate ?? 0;
  const months = payment > 0 ? monthsToPayoff(owed, rate, payment) : null;

  const detail = [
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
  ].filter(Boolean);

  return (
    <div className="account-row" style={{ flexWrap: "wrap" }}>
      <div className="account-row__info">
        <div className="account-row__name">{account.name}</div>
        <div className="account-row__meta">
          {detail.length > 0 ? detail.join(" · ") : "No terms recorded — upload the agreement on the Accounts page"}
        </div>
      </div>
      <span className="account-row__balance">{formatCurrency(owed, account.currency)}</span>
    </div>
  );
}

export default function DebtPlanner() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [apr, setApr] = useState("");
  const [minPayment, setMinPayment] = useState("");

  const refresh = useCallback(() => {
    api.listDebts().then(setDebts);
    api.listAccounts().then(setAccounts);
    api.listTransactions().then(setTransactions);
  }, []);

  useEffect(refresh, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !balance || !minPayment) return;
    await api.createDebt({ name: name.trim(), balance: Number(balance), apr: Number(apr) || 0, minimum_payment: Number(minPayment) });
    setName("");
    setBalance("");
    setApr("");
    setMinPayment("");
    refresh();
  }

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayment = debts.reduce((s, d) => s + d.minimum_payment, 0);

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }
  // Only accounts actually in debt: a card sitting at zero, or in credit, is
  // not something to plan a payoff for.
  const borrowing = accounts.filter(
    (a) => isLiability(a) && accountBalance(a, byAccount.get(a.id) ?? 0) < 0
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Debt Planner</h1>
          <p className="page-header__subtitle">Track balances and see payoff time at your minimum payment</p>
        </div>
      </div>

      {debts.length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <StatTile label="Total debt" value={totalBalance.toFixed(2)} />
            <StatTile label="Total minimum payments" value={totalMinPayment.toFixed(2)} />
          </div>
        </div>
      )}

      {borrowing.length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card__header">
            <h2 className="card__title">Credit cards and loans</h2>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
              From your accounts. Balances and terms are edited there, not here.
            </p>
          </div>
          {borrowing.map((a) => (
            <AccountDebtRow key={a.id} account={a} txSum={byAccount.get(a.id) ?? 0} />
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card__header">
          <h2 className="card__title">Add a debt</h2>
        </div>
        <form onSubmit={handleCreate} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="Name (e.g. Credit card)" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" step="0.01" min="0" placeholder="Balance" value={balance} onChange={(e) => setBalance(e.target.value)} />
          <input type="number" step="0.01" min="0" placeholder="APR %" value={apr} onChange={(e) => setApr(e.target.value)} />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Minimum payment"
            value={minPayment}
            onChange={(e) => setMinPayment(e.target.value)}
          />
          <button type="submit" className="btn-accent">
            Add debt
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Your debts (highest APR first)</h2>
        </div>
        {debts.length === 0 ? (
          <p className="empty-state">No debts tracked yet.</p>
        ) : (
          <div>
            {debts.map((d) => (
              <DebtRow key={d.id} debt={d} onChanged={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
