import { Check, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Account, type Category, type PendingTransaction } from "../../api/client.js";
import CategorySelect from "../CategorySelect.js";
import { cleanDescription } from "../../utils/cleanDescription.js";
import { formatCurrency } from "../../utils/formatCurrency.js";

// Per-row category choice starts at the suggested category but the user can
// override it before approving — a row only gets an entry in `selections`
// once the user actually changes its dropdown, so any untouched row falls
// back to its suggestion without needing to pre-seed state from an effect.
export default function PendingReviewWidget({
  transactions,
  categories,
  accounts = [],
  onApproved,
}: {
  transactions: PendingTransaction[];
  categories: Category[];
  /** Enables the account filter, and names the account on each row. */
  accounts?: Account[];
  onApproved: () => void;
}) {
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [suggesting, setSuggesting] = useState(false);
  const [proposed, setProposed] = useState<string[]>([]);
  const [known, setKnown] = useState<Category[]>(categories);

  useEffect(() => setKnown(categories), [categories]);

  async function suggestAll() {
    setSuggesting(true);
    try {
      const result = await api.categorisePending();
      // Only fills rows the user hasn't decided — a suggestion must never
      // overwrite a choice already made.
      setSelections((current) => {
        const next = { ...current };
        for (const s of result.suggestions) {
          if (s.categoryId != null && !(s.id in next)) next[s.id] = s.categoryId;
        }
        return next;
      });
      setProposed(result.proposed);
    } finally {
      setSuggesting(false);
    }
  }

  // The server matches case-insensitively and returns an existing category
  // rather than creating a duplicate, so this is safe to call repeatedly.
  async function createCategory(name: string) {
    const category = await api.createCategory(name.trim());
    setKnown((cs) => (cs.some((c) => c.id === category.id) ? cs : [...cs, category].sort((a, b) => a.name.localeCompare(b.name))));
    setProposed((p) => p.filter((n) => n.toLowerCase() !== name.trim().toLowerCase()));
    return category;
  }

  function selectedCategory(t: PendingTransaction): number | null {
    return t.id in selections ? selections[t.id] : t.suggested_category_id;
  }

  async function approve(t: PendingTransaction) {
    setApprovingId(t.id);
    try {
      await api.approveTransaction(t.id, selectedCategory(t));
      onApproved();
    } finally {
      setApprovingId(null);
    }
  }

  // Bulk actions deliberately operate on the filtered set, not everything:
  // the search is how you choose what to act on, so "approve all" while a
  // filter is active must mean the rows you can see.
  const needle = query.trim().toLowerCase();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const visible = transactions.filter((t) => {
    if (accountId && t.account_id !== accountId) return false;
    if (!needle) return true;
    return [t.description, t.counterparty, t.booking_date, t.amount.toFixed(2), accountName.get(t.account_id)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });

  // Only accounts with something waiting are worth offering, with their
  // counts — an account with nothing pending is a dead end in the dropdown.
  const pendingByAccount = new Map<string, number>();
  for (const t of transactions) pendingByAccount.set(t.account_id, (pendingByAccount.get(t.account_id) ?? 0) + 1);
  const filterableAccounts = accounts.filter((a) => pendingByAccount.has(a.id));

  async function approveVisible() {
    setApprovingAll(true);
    try {
      await api.bulkApproveTransactions(visible.map((t) => ({ id: t.id, category_id: selectedCategory(t) })));
      onApproved();
    } finally {
      setApprovingAll(false);
    }
  }

  function categoriseVisible(categoryId: number | null) {
    setSelections((current) => {
      const next = { ...current };
      for (const t of visible) next[t.id] = categoryId;
      return next;
    });
  }

  if (transactions.length === 0) {
    return <p className="empty-state">No new transactions to review.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <Search size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          value={query}
          placeholder="Search description, payee, date or amount"
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 120, fontSize: "0.82rem" }}
        />
        {filterableAccounts.length > 1 && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={{ fontSize: "0.82rem", maxWidth: 170 }}
            aria-label="Filter by account"
          >
            <option value="">All accounts ({transactions.length})</option>
            {filterableAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({pendingByAccount.get(a.id)})
              </option>
            ))}
          </select>
        )}
        {(query || accountId) && (
          <button
            onClick={() => {
              setQuery("");
              setAccountId("");
            }}
            aria-label="Clear filters"
            title="Clear filters"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginRight: "auto" }}>
          {visible.length === transactions.length
            ? `${transactions.length} awaiting review`
            : `${visible.length} of ${transactions.length} shown`}
        </span>

        {/* Sets a category on every visible row at once — the point of
            searching for, say, "tesco" and filing the lot in one go. */}
        <CategorySelect
          categories={known}
          value={null}
          onChange={(id) => categoriseVisible(id)}
          onCreate={createCategory}
          placeholder={visible.length === transactions.length ? "Set all to…" : `Set ${visible.length} to…`}
          width={150}
        />

        <button onClick={suggestAll} disabled={suggesting}>
          {suggesting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          Suggest
        </button>
        <button className="btn-accent" onClick={approveVisible} disabled={approvingAll || visible.length === 0}>
          <Check size={14} />
          Approve {visible.length === transactions.length ? "all" : visible.length}
        </button>
      </div>

      {proposed.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Suggested new categories:</span>
          {proposed.map((name) => (
            <button key={name} onClick={() => createCategory(name)} style={{ fontSize: "0.8rem" }}>
              <Plus size={12} />
              {name}
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 && <p className="empty-state">No transactions match “{query.trim()}”.</p>}

      {visible.map((t) => (
        <div className="tx-row" key={t.id}>
          <div className="tx-row__info">
            {/* Same cleaning the transactions table does, and titled so the
                full bank text is still reachable when the row clips it. */}
            <div className="tx-row__name" title={t.description ?? undefined}>
              {cleanDescription(t.description) || t.counterparty || "Transaction"}
            </div>
            <div className="tx-row__meta">
              {t.booking_date}
              {/* Named only when more than one account has rows waiting —
                  otherwise it's the same word on every line. */}
              {filterableAccounts.length > 1 && accountName.has(t.account_id) && ` · ${accountName.get(t.account_id)}`}
              {t.suggestion_source === "ai" && !(t.id in selections) && (
                <span
                  title="Suggested by AI — check before approving"
                  style={{
                    marginLeft: "0.4rem",
                    padding: "0.05rem 0.3rem",
                    borderRadius: 4,
                    fontSize: "0.7rem",
                    background: "color-mix(in srgb, var(--accent) 18%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  AI
                </span>
              )}
            </div>
          </div>
          <CategorySelect
            categories={known}
            value={selectedCategory(t)}
            onChange={(id) => setSelections((s) => ({ ...s, [t.id]: id }))}
            onCreate={createCategory}
            width={130}
          />
          <span className={`tx-row__amount${t.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
            {t.amount >= 0 ? "+" : ""}
            {formatCurrency(t.amount, t.currency)}
          </span>
          <button className="icon-button" aria-label="Approve" onClick={() => approve(t)} disabled={approvingId === t.id}>
            <Check size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
