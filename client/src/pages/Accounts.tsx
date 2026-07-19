import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type Transaction } from "../api/client.js";
import { avatarColorVar, initials } from "../utils/avatarColor.js";

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listAccounts().then(setAccounts);
    api.listTransactions().then(setTransactions);
  }, []);

  useEffect(refresh, [refresh]);

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createAccount(name.trim(), currency);
    setName("");
    refresh();
  }

  async function handleSync(accountId: string) {
    setSyncingId(accountId);
    try {
      await api.syncAccount(accountId);
      refresh();
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="page-header__subtitle">{accounts.length} account{accounts.length === 1 ? "" : "s"}</p>
        </div>
        <Link to="/bank-link" className="btn-accent" style={{ textDecoration: "none", borderRadius: 8, padding: "0.5rem 0.9rem" }}>
          Link a bank
        </Link>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card__header">
          <h2 className="card__title">Add a manual account</h2>
        </div>
        <form onSubmit={handleCreate} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
          <button type="submit" className="btn-accent">
            Add account
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">All accounts</h2>
        </div>
        {accounts.length === 0 ? (
          <p className="empty-state">No accounts yet — add one manually above or link a bank.</p>
        ) : (
          <div>
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <div className="avatar-chip" style={{ background: avatarColorVar(a.name) }}>
                  {initials(a.name)}
                </div>
                <div className="account-row__info">
                  <div className="account-row__name">{a.name}</div>
                  <div className="account-row__meta">
                    <span className="status-dot" />
                    {a.source === "enablebanking" ? "Linked via Enable Banking" : "Manual"} · {a.currency}
                  </div>
                </div>
                {a.source === "enablebanking" && (
                  <button onClick={() => handleSync(a.id)} disabled={syncingId === a.id} title="Sync transactions" aria-label="Sync">
                    <RefreshCw size={14} className={syncingId === a.id ? "spin" : undefined} />
                  </button>
                )}
                <span className="account-row__balance">{(byAccount.get(a.id) ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
