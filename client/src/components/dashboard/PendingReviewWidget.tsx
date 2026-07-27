import { Check, Loader2, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Category, type PendingTransaction } from "../../api/client.js";
import CategorySelect from "../CategorySelect.js";

// Per-row category choice starts at the suggested category but the user can
// override it before approving — a row only gets an entry in `selections`
// once the user actually changes its dropdown, so any untouched row falls
// back to its suggestion without needing to pre-seed state from an effect.
export default function PendingReviewWidget({
  transactions,
  categories,
  onApproved,
}: {
  transactions: PendingTransaction[];
  categories: Category[];
  onApproved: () => void;
}) {
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
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

  async function approveAll() {
    setApprovingAll(true);
    try {
      await api.bulkApproveTransactions(transactions.map((t) => ({ id: t.id, category_id: selectedCategory(t) })));
      onApproved();
    } finally {
      setApprovingAll(false);
    }
  }

  if (transactions.length === 0) {
    return <p className="empty-state">No new transactions to review.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", marginBottom: "0.6rem" }}>
        <button onClick={suggestAll} disabled={suggesting}>
          {suggesting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          Suggest categories
        </button>
        <button className="btn-accent" onClick={approveAll} disabled={approvingAll}>
          <Check size={14} />
          Approve all
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
      {transactions.map((t) => (
        <div className="tx-row" key={t.id}>
          <div className="tx-row__info">
            <div className="tx-row__name">{t.description || t.counterparty || "Transaction"}</div>
            <div className="tx-row__meta">
              {t.booking_date}
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
            {t.amount.toFixed(2)}
          </span>
          <button className="icon-button" aria-label="Approve" onClick={() => approve(t)} disabled={approvingId === t.id}>
            <Check size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
