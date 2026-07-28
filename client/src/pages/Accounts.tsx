import { Check, Eraser, FileText, Loader2, Pencil, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type AccountType, type LoanTerms, type Transaction } from "../api/client.js";
import AccountAvatar from "../components/AccountAvatar.js";
import LoanContractModal from "../components/LoanContractModal.js";
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
  // A detected bank waits here for the user to accept it. Nothing is written
  // until they do — a wrong logo is worse than a blank avatar.
  const [detectingId, setDetectingId] = useState<string | null>(null);
  const [readingContract, setReadingContract] = useState<string | null>(null);
  const [contractTerms, setContractTerms] = useState<{ account: Account; terms: LoanTerms } | null>(null);
  const [detected, setDetected] = useState<{
    accountId: string;
    match: { name: string; logo: string | null; confidence: string; source: string } | null;
  } | null>(null);

  // One hidden input reused by every row's upload button — the account it
  // belongs to is stashed here when the button is clicked.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<Account | null>(null);
  // Which reader the pending file is destined for. A ref rather than state
  // because the file dialog resolves outside React's update cycle.
  const contractModeRef = useRef(false);

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

  /**
   * Changing the type mid-edit reinterprets the number already in the field,
   * so the number has to change with it.
   *
   * The field is filled as a balance for a cheque account and as an amount
   * owed for a card, and those are opposite signs. Without this, switching an
   * overdrawn account to Credit card left -9,400 sitting under a label
   * reading "Owed", and saving stored it as 9,400 held — the account then
   * reads as money in hand and drops out of the debt view entirely.
   */
  function changeType(next: AccountType) {
    const wasLiability = typeDraft === "credit_card" || typeDraft === "loan";
    const nowLiability = next === "credit_card" || next === "loan";
    if (wasLiability !== nowLiability) {
      const parsed = parseDraft(balanceDraft);
      if (typeof parsed === "number") setBalanceDraft(String(-parsed));
    }
    setTypeDraft(next);
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

  // A loan agreement goes through the same upload button as a statement, but
  // a different reader — which one is decided by what the button was for, not
  // by guessing at the file, since misreading a statement as a contract would
  // put invented terms in front of the user.
  function startContractUpload(account: Account) {
    uploadTargetRef.current = account;
    contractModeRef.current = true;
    setImportNotice(null);
    fileInputRef.current?.click();
  }

  async function readContract(account: Account, contentBase64: string) {
    setReadingContract(account.id);
    setImportNotice(null);
    try {
      const terms = await api.previewLoanContract(account.id, contentBase64);
      setContractTerms({ account, terms });
    } catch (err) {
      setImportNotice(err instanceof Error ? err.message : "Could not read that contract.");
    } finally {
      setReadingContract(null);
    }
  }

  async function detectBank(account: Account) {
    setDetectingId(account.id);
    setDetected(null);
    try {
      const match = await api.detectAccountBank(account.id);
      setDetected({ accountId: account.id, match });
    } finally {
      setDetectingId(null);
    }
  }

  async function applyDetectedBank(accountId: string, match: { name: string; logo: string | null }) {
    await api.updateAccount(accountId, { logo: match.logo, institution_name: match.name });
    setDetected(null);
    refresh();
  }

  function startUpload(account: Account) {
    uploadTargetRef.current = account;
    contractModeRef.current = false;
    setImportNotice(null);
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const account = uploadTargetRef.current;
    const asContract = contractModeRef.current;
    // Reset immediately so re-picking the same file still fires a change event.
    e.target.value = "";
    contractModeRef.current = false;
    if (!file || !account) return;

    // Bytes rather than text: a PDF read as text is mojibake, and the server
    // decides the format from the content anyway.
    const contentBase64 = await fileToBase64(file);
    if (asContract) {
      await readContract(account, contentBase64);
      return;
    }
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
                  {/* Tapping a blank avatar looks for the bank in the account's
                      own name. Accounts that already carry a logo are left
                      alone — there's nothing to find. */}
                  {a.logo ? (
                    <AccountAvatar name={a.name} logo={a.logo} />
                  ) : (
                    <button
                      onClick={() => detectBank(a)}
                      disabled={detectingId === a.id}
                      title="Find this account's bank logo"
                      aria-label={`Find the bank logo for ${a.name}`}
                      style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", position: "relative" }}
                    >
                      <AccountAvatar name={a.name} logo={null} />
                      {detectingId === a.id ? (
                        <Loader2 size={12} className="spin" style={{ position: "absolute", right: -2, bottom: -2 }} />
                      ) : (
                        <Sparkles size={12} color="var(--accent)" style={{ position: "absolute", right: -2, bottom: -2 }} />
                      )}
                    </button>
                  )}
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
                    {detected?.accountId === a.id && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", margin: "0.25rem 0", flexWrap: "wrap" }}>
                        {detected.match?.logo ? (
                          <>
                            <img src={detected.match.logo} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
                            {/* Naming the source matters: a directory match is
                                the same asset a linked account of that bank
                                shows, while a domain is a best guess from the
                                open internet. */}
                            <span style={{ fontSize: "0.78rem" }}>
                              {detected.match.name}
                              <span style={{ color: "var(--text-muted)" }}>
                                {" · "}
                                {detected.match.source === "directory" ? "from your bank directory" : detected.match.source} ·{" "}
                                {detected.match.confidence} confidence
                              </span>
                            </span>
                            <button
                              onClick={() => applyDetectedBank(a.id, detected.match!)}
                              aria-label="Use this logo"
                              title="Use this logo"
                              style={{ padding: "0.2rem", display: "flex" }}
                            >
                              <Check size={13} />
                            </button>
                            <button onClick={() => setDetected(null)} aria-label="Discard" title="Discard" style={{ padding: "0.2rem", display: "flex" }}>
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                            No bank matched “{a.name}” — rename it to include the bank and try again.
                            <button onClick={() => setDetected(null)} style={{ marginLeft: "0.4rem", padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}>
                              Dismiss
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="account-row__meta">
                      <span className="status-dot" />
                      {accountTypeLabel(a)} ·{" "}
                      {a.source === "enablebanking" ? a.institution_name ?? "Linked via Enable Banking" : "Manual"} · {a.currency}
                    </div>
                  </div>
                  {/* Two uploads that read the same file completely
                      differently, so they are labelled rather than left as
                      neighbouring icons — picking the wrong one silently gives
                      you the wrong reader. Both are offered on every account:
                      a credit card has an agreement too, and an account whose
                      type hasn't been set yet still has one. */}
                  <button
                    onClick={() => startUpload(a)}
                    title="Import transactions from a statement"
                    aria-label={`Upload a statement for ${a.name}`}
                    style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", whiteSpace: "nowrap" }}
                  >
                    <Upload size={13} color="var(--text-muted)" />
                    Statement
                  </button>
                  <button
                    onClick={() => startContractUpload(a)}
                    disabled={readingContract === a.id}
                    title="Read the terms from a loan or credit agreement"
                    aria-label={`Upload the agreement for ${a.name}`}
                    style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", whiteSpace: "nowrap" }}
                  >
                    {readingContract === a.id ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <FileText size={13} color="var(--text-muted)" />
                    )}
                    {readingContract === a.id ? "Reading…" : "Agreement"}
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
                    // Wraps because four fields don't fit a phone in one line,
                    // and a row that overflows puts Save off-screen.
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        Type
                        <select
                          value={typeDraft}
                          onChange={(e) => changeType(e.target.value as AccountType)}
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
                      {/* The number itself stays clickable, but a bare figure
                          is not an obvious control — the pencil is what makes
                          it findable, matching the one on the account name. */}
                      <button
                        onClick={() => startEditingBalance(a, byAccount.get(a.id) ?? 0)}
                        title="Set balance, type and facility"
                        aria-label={`Set balance for ${a.name}`}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          marginLeft: "auto",
                        }}
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
                        <Pencil size={12} color="var(--text-muted)" />
                      </button>
                      {/* Always sits under the balance, so the two figures can
                          be read against each other the way the bank's own app
                          shows them. A facility is borrowing, so it lands here
                          and never in the balance or in net worth. */}
                      {hasAvailable(a) && (
                        <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {formatCurrency(accountAvailable(a, byAccount.get(a.id) ?? 0), a.currency)} available
                          {a.overdraft_limit
                            ? ` · incl. ${formatCurrency(a.overdraft_limit, a.currency)} ${facilityLabel(a)?.toLowerCase() ?? ""}`
                            : ""}
                        </span>
                      )}
                      {/* The facility is a fixed contractual figure, but it
                          can be entered by way of an available balance — and
                          that is a snapshot of two moving numbers, so it goes
                          stale as soon as the balance moves. Naming it plainly
                          is what lets it be checked against the bank. */}
                      {a.balance_synced_at && (
                        <span style={{ display: "block", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                          synced{" "}
                          {new Date(a.balance_synced_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </span>
                      )}
                      {a.balance_is_manual && a.balance != null && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)" }}>set by hand</span>
                      )}
                      {/* A card or loan holding money is possible but rare —
                          far more often the sign is inverted, which is silent
                          and drops the account out of the debt view. Offering
                          the flip is quicker than re-typing the figure and
                          makes the problem legible either way. */}
                      {isLiability(a) && (a.balance ?? 0) > 0 && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "var(--critical)" }}>
                          in credit, not owed —{" "}
                          <button
                            onClick={() => api.updateAccount(a.id, { balance: -(a.balance ?? 0) }).then(refresh)}
                            style={{ padding: "0.1rem 0.3rem", fontSize: "0.7rem" }}
                          >
                            owe {formatCurrency(a.balance ?? 0, a.currency)} instead
                          </button>
                        </span>
                      )}
                      {(a.loan_rate != null || a.loan_monthly_payment != null || a.loan_end_date) && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {[
                            a.loan_rate != null ? `${a.loan_rate}%` : null,
                            a.loan_monthly_payment != null ? `${formatCurrency(a.loan_monthly_payment, a.currency)}/mo` : null,
                            a.loan_end_date ? `to ${a.loan_end_date}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
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

      {contractTerms && (
        <LoanContractModal
          accountId={contractTerms.account.id}
          accountName={contractTerms.account.name}
          currency={contractTerms.account.currency}
          terms={contractTerms.terms}
          onClose={() => setContractTerms(null)}
          onSaved={() => {
            setContractTerms(null);
            setImportNotice(`Saved the loan terms for ${contractTerms.account.name}.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
