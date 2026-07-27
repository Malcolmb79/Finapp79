import { Check } from "lucide-react";
import { useState } from "react";
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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.6rem" }}>
        <button className="btn-accent" onClick={approveAll} disabled={approvingAll}>
          <Check size={14} />
          Approve all
        </button>
      </div>
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
            categories={categories}
            value={selectedCategory(t)}
            onChange={(id) => setSelections((s) => ({ ...s, [t.id]: id }))}
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
