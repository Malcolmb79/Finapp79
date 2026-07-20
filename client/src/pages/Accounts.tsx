import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type Transaction } from "../api/client.js";
import AccountAvatar from "../components/AccountAvatar.js";
import { accountBalance } from "../utils/accountBalance.js";
import { formatCurrency } from "../utils/formatCurrency.js";

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  function startEditing(a: Account) {
    setEditingId(a.id);
    setEditingName(a.name);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveRename(id: string) {
    if (!editingName.trim()) return;
    setSavingRename(true);
    try {
      await api.renameAccount(id, editingName.trim());
      setEditingId(null);
      refresh();
    } finally {
      setSavingRename(false);
    }
  }

  async function handleRemove(id: string) {
    setDeleting(true);
    try {
      await api.deleteAccount(id);
      setRemovingId(null);
      refresh();
    } finally {
      setDeleting(false);
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
            {accounts.map((a) => {
              const isEditing = editingId === a.id;
              return (
                <div className="account-row" key={a.id}>
                  <AccountAvatar name={a.name} logo={a.logo} />
                  <div className="account-row__info">
                    {isEditing ? (
                      <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(a.id);
                            if (e.key === "Escape") cancelEditing();
                          }}
                          style={{ fontSize: "0.9rem", padding: "0.25rem 0.5rem" }}
                        />
                        <button
                          onClick={() => saveRename(a.id)}
                          disabled={savingRename || !editingName.trim()}
                          aria-label="Save name"
                          title="Save"
                          style={{ padding: "0.3rem", display: "flex" }}
                        >
                          <Check size={14} />
                        </button>
                        <button onClick={cancelEditing} aria-label="Cancel" title="Cancel" style={{ padding: "0.3rem", display: "flex" }}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="account-row__name" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {a.name}
                        <button
                          onClick={() => startEditing(a)}
                          aria-label="Rename account"
                          title="Rename"
                          style={{ padding: "0.15rem", display: "flex", background: "transparent", border: "none" }}
                        >
                          <Pencil size={12} color="var(--text-muted)" />
                        </button>
                      </div>
                    )}
                    <div className="account-row__meta">
                      <span className="status-dot" />
                      {a.source === "enablebanking" ? a.institution_name ?? "Linked via Enable Banking" : "Manual"} · {a.currency}
                    </div>
                  </div>
                  {a.source === "enablebanking" && (
                    <button onClick={() => handleSync(a.id)} disabled={syncingId === a.id} title="Sync transactions" aria-label="Sync">
                      <RefreshCw size={14} className={syncingId === a.id ? "spin" : undefined} />
                    </button>
                  )}
                  {removingId === a.id ? (
                    <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.78rem", color: "var(--critical)", whiteSpace: "nowrap" }}>Remove?</span>
                      <button
                        onClick={() => handleRemove(a.id)}
                        disabled={deleting}
                        aria-label="Confirm remove account"
                        title="Confirm remove"
                        style={{ padding: "0.3rem", display: "flex", color: "var(--critical)" }}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setRemovingId(null)}
                        disabled={deleting}
                        aria-label="Cancel remove"
                        title="Cancel"
                        style={{ padding: "0.3rem", display: "flex" }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setRemovingId(a.id)} aria-label="Remove account" title="Remove account">
                      <Trash2 size={14} color="var(--text-muted)" />
                    </button>
                  )}
                  <div style={{ textAlign: "right" }}>
                    <span className="account-row__balance" style={{ display: "block" }}>
                      {formatCurrency(accountBalance(a, byAccount.get(a.id) ?? 0), a.currency)}
                    </span>
                    {a.source === "enablebanking" && a.available_balance != null && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        {formatCurrency(a.available_balance, a.currency)} available
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
