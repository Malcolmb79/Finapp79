import { Check, Eraser, Pencil, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type AccountType, type Transaction } from "../api/client.js";
import AccountAvatar from "../components/AccountAvatar.js";
import StatementImportModal from "../components/StatementImportModal.js";
import {
  ACCOUNT_TYPES,
  accountAvailable,
  accountBalance,
  accountTypeLabel,
  facilityLabel,
  hasAvailable,
  isLiability,
} from "../utils/accountBalance.js";
import { fileToBase64 } from "../utils/fileBytes.js";
import { formatCurrency } from "../utils/formatCurrency.js";

interface PendingUpload {
  accountId: string;
  accountName: string;
  filename: string;
  contentBase64: string;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [newType, setNewType] = useState<AccountType>("current");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  // Which account is showing its clear-transactions choices. Deleting history
  // is irreversible, so it takes a deliberate second click rather than one.
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  // Which account's balance/overdraft is being edited, and the drafts. Kept
  // as strings so the fields can be emptied — "" means clear it, which is a
  // different intent from 0.
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [balanceDraft, setBalanceDraft] = useState("");
  const [overdraftDraft, setOverdraftDraft] = useState("");
  // The available figure and the overdraft are two views of one number, so
  // whichever was typed into last is the one that wins on save — otherwise
  // the untouched field's stale value would silently overwrite the edit.
  const [availableDraft, setAvailableDraft] = useState("");
  const [typeDraft, setTypeDraft] = useState<AccountType>("current");
  const [lastEdited, setLastEdited] = useState<"overdraft" | "available">("overdraft");
  const [savingBalance, setSavingBalance] = useState(false);

  // One hidden input reused by every row's upload button — the account it
  // belongs to is stashed here when the button is clicked.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<Account | null>(null);

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
    await api.createAccount(name.trim(), currency, newType);
    setName("");
    refresh();
  }

  function startEditingBalance(account: Account, txSum: number) {
    setEditingBalanceId(account.id);
    // Debts are entered the way they're thought about — 1,200 owed, not
    // -1,200 held. saveBalance puts the sign back.
    const balance = accountBalance(account, txSum);
    setBalanceDraft(String(isLiability(account) ? -balance : balance));
    setOverdraftDraft(account.overdraft_limit != null ? String(account.overdraft_limit) : "");
    setAvailableDraft(String(accountAvailable(account, txSum)));
    setTypeDraft(account.account_type ?? "current");
    setLastEdited("overdraft");
  }

  // "" and 0 are deliberately different: "" clears (handing the balance back
  // to the transaction history, or removing the overdraft), 0 is a real zero.
  // Anything unparseable leaves that field untouched rather than writing a
  // guess over a real figure.
  function parseDraft(value: string) {
    const trimmed = value.trim().replace(/[,\s€£$]/g, "");
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * The facility implied by an available figure typed in directly.
   *
   * Banks publish "available funds" (AIB shows 6,599.26) but not the facility
   * behind it, so typing the number from the banking app is easier than
   * working out the difference by hand. On a card the same sum gives the
   * credit limit: 3,800 available against 1,200 owed is a 5,000 limit.
   *
   * Returns undefined when the sum can't be taken, and null when available is
   * at or below the balance — that gap is a hold or a pending item, not a
   * negative facility.
   */
  function facilityFromAvailable(available: string, signedBalance: number): number | null | undefined {
    const a = parseDraft(available);
    if (a === undefined) return undefined;
    if (a === null) return null;
    return a > signedBalance ? Number((a - signedBalance).toFixed(2)) : null;
  }

  async function saveBalance(account: Account) {
    const entered = parseDraft(balanceDraft);
    // A debt is stored as a negative balance — that convention is what makes
    // net worth come out right by plain addition — but it's entered as a
    // positive figure, so the sign goes back on here.
    const liability = typeDraft === "credit_card" || typeDraft === "loan";
    const balance = entered == null ? entered : liability ? -entered : entered;

    const overdraft =
      lastEdited === "available"
        ? facilityFromAvailable(availableDraft, typeof balance === "number" ? balance : 0)
        : parseDraft(overdraftDraft);

    setSavingBalance(true);
    try {
      await api.updateAccount(account.id, {
        ...(balance !== undefined ? { balance } : {}),
        ...(overdraft !== undefined ? { overdraft_limit: overdraft === null ? null : Math.abs(overdraft) } : {}),
        ...(typeDraft !== (account.account_type ?? "current") ? { account_type: typeDraft } : {}),
      });
      setEditingBalanceId(null);
      refresh();
    } finally {
      setSavingBalance(false);
    }
  }

  function startUpload(account: Account) {
    uploadTargetRef.current = account;
    setImportNotice(null);
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const account = uploadTargetRef.current;
    // Reset immediately so re-picking the same file still fires a change event.
    e.target.value = "";
    if (!file || !account) return;

    // Bytes rather than text: a PDF read as text is mojibake, and the server
    // decides the format from the content anyway.
    const contentBase64 = await fileToBase64(file);
    setUpload({ accountId: account.id, accountName: account.name, filename: file.name, contentBase64 });
  }

  async function handleClear(account: Account, source?: "csv") {
    setClearing(true);
    try {
      const { deleted } = await api.clearAccountTransactions(account.id, source);
      setImportNotice(
        `Removed ${deleted} ${source === "csv" ? "imported " : ""}transaction${deleted === 1 ? "" : "s"} from ${account.name}.`
      );
      setClearingId(null);
      refresh();
    } finally {
      setClearing(false);
    }
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
            <option value="ZAR">ZAR</option>
          </select>
          <select value={newType} onChange={(e) => setNewType(e.target.value as AccountType)} aria-label="Account type">
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
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
                      {accountTypeLabel(a)} ·{" "}
                      {a.source === "enablebanking" ? a.institution_name ?? "Linked via Enable Banking" : "Manual"} · {a.currency}
                    </div>
                  </div>
                  <button onClick={() => startUpload(a)} title="Upload statement" aria-label={`Upload statement for ${a.name}`}>
                    <Upload size={14} color="var(--text-muted)" />
                  </button>
                  {clearingId === a.id ? (
                    <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.78rem", color: "var(--critical)", whiteSpace: "nowrap" }}>Clear:</span>
                      <button onClick={() => handleClear(a, "csv")} disabled={clearing} style={{ fontSize: "0.78rem" }}>
                        Imported only
                      </button>
                      <button
                        onClick={() => handleClear(a)}
                        disabled={clearing}
                        style={{ fontSize: "0.78rem", color: "var(--critical)" }}
                      >
                        Everything
                      </button>
                      <button onClick={() => setClearingId(null)} disabled={clearing} aria-label="Cancel clear" title="Cancel">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setClearingId(a.id)}
                      title="Clear transactions (keeps the account)"
                      aria-label={`Clear transactions for ${a.name}`}
                    >
                      <Eraser size={14} color="var(--text-muted)" />
                    </button>
                  )}
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
                  {editingBalanceId === a.id ? (
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        Type
                        <select
                          value={typeDraft}
                          onChange={(e) => setTypeDraft(e.target.value as AccountType)}
                          style={{ display: "block", fontSize: "0.85rem", padding: "0.25rem 0.4rem" }}
                        >
                          {ACCOUNT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {/* Labelled by what the figure means on this type: a card
                          and a loan hold a debt, so the amount owed is entered
                          as a positive number and stored negative. */}
                      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {typeDraft === "credit_card" || typeDraft === "loan" ? "Owed" : "Balance"}
                        <input
                          autoFocus
                          inputMode="decimal"
                          value={balanceDraft}
                          onChange={(e) => setBalanceDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveBalance(a);
                            if (e.key === "Escape") setEditingBalanceId(null);
                          }}
                          placeholder="from history"
                          style={{ display: "block", width: 110, fontSize: "0.85rem", padding: "0.25rem 0.4rem" }}
                        />
                      </label>
                      {/* A loan has no facility — the principal is already the
                          balance — and a savings account has none either. */}
                      {facilityLabel({ ...a, account_type: typeDraft }) && (
                        <>
                          <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {facilityLabel({ ...a, account_type: typeDraft })}
                            <input
                              inputMode="decimal"
                              value={overdraftDraft}
                              onChange={(e) => {
                                setOverdraftDraft(e.target.value);
                                setLastEdited("overdraft");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveBalance(a);
                                if (e.key === "Escape") setEditingBalanceId(null);
                              }}
                              placeholder="none"
                              style={{ display: "block", width: 100, fontSize: "0.85rem", padding: "0.25rem 0.4rem" }}
                            />
                          </label>
                          {/* Type the "available funds" figure straight from the
                              banking app and the facility behind it is worked
                              out from the balance — banks publish the total but
                              not the facility. */}
                          <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            Available
                            <input
                              inputMode="decimal"
                              value={availableDraft}
                              onChange={(e) => {
                                setAvailableDraft(e.target.value);
                                setLastEdited("available");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveBalance(a);
                                if (e.key === "Escape") setEditingBalanceId(null);
                              }}
                              placeholder="balance"
                              style={{ display: "block", width: 110, fontSize: "0.85rem", padding: "0.25rem 0.4rem" }}
                            />
                          </label>
                        </>
                      )}
                      <button
                        onClick={() => saveBalance(a)}
                        disabled={savingBalance}
                        aria-label="Save balance"
                        title="Save"
                        style={{ padding: "0.3rem", display: "flex" }}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setEditingBalanceId(null)}
                        disabled={savingBalance}
                        aria-label="Cancel balance edit"
                        title="Cancel"
                        style={{ padding: "0.3rem", display: "flex" }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ textAlign: "right" }}>
                      <button
                        onClick={() => startEditingBalance(a, byAccount.get(a.id) ?? 0)}
                        title="Set balance and overdraft"
                        aria-label={`Set balance and overdraft for ${a.name}`}
                        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "block", marginLeft: "auto" }}
                      >
                        <span className="account-row__balance">
                          {/* Debts read as what's owed rather than as a
                              negative holding, which is how a card statement
                              and a loan statement both present them. */}
                          {formatCurrency(
                            isLiability(a) ? -accountBalance(a, byAccount.get(a.id) ?? 0) : accountBalance(a, byAccount.get(a.id) ?? 0),
                            a.currency
                          )}
                          {isLiability(a) && <span style={{ fontSize: "0.7rem", fontWeight: 400 }}> owed</span>}
                        </span>
                      </button>
                      {/* Always sits under the balance, so the two figures can
                          be read against each other the way the bank's own app
                          shows them. A facility is borrowing, so it lands here
                          and never in the balance or in net worth. */}
                      {hasAvailable(a) && (
                        <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {formatCurrency(accountAvailable(a, byAccount.get(a.id) ?? 0), a.currency)} available
                          {a.overdraft_limit
                            ? ` · ${formatCurrency(a.overdraft_limit, a.currency)} ${facilityLabel(a)?.toLowerCase() ?? ""}`
                            : ""}
                        </span>
                      )}
                      {a.balance_is_manual && a.balance != null && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)" }}>set by hand</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deliberately unfiltered: bank exports are often delivered with no
          extension at all, and an accept list hides them in the picker. The
          parser reads the content rather than trusting the name, and a file
          that isn't delimited text comes back as a clear "nothing readable
          here" rather than importing anything. */}
      <input ref={fileInputRef} type="file" onChange={handleFileChosen} style={{ display: "none" }} />

      {importNotice && (
        <p role="status" style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {importNotice}
        </p>
      )}

      {upload && (
        <StatementImportModal
          accountId={upload.accountId}
          accountName={upload.accountName}
          filename={upload.filename}
          contentBase64={upload.contentBase64}
          onClose={() => setUpload(null)}
          onImported={({ imported, duplicates, brandedAs }) => {
            setUpload(null);
            setImportNotice(
              `Imported ${imported} transaction${imported === 1 ? "" : "s"}` +
                (duplicates > 0 ? `, skipped ${duplicates} already imported` : "") +
                (brandedAs ? `, matched to ${brandedAs}` : "") +
                ". They're waiting in New transactions for review."
            );
            refresh();
          }}
        />
      )}
    </div>
  );
}
