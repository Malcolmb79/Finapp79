import { Calendar, Landmark, Tag, Trash2, User, X } from "lucide-react";
import { useState } from "react";
import { api, type Account, type Category, type Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { formatCurrency } from "../utils/formatCurrency.js";

const SOURCE_LABEL: Record<Transaction["source"], string> = {
  enablebanking: "Synced from bank",
  manual: "Manual entry",
  csv: "CSV import",
};

export default function TransactionDetailModal({
  transaction,
  account,
  categories,
  onClose,
  onChange,
}: {
  transaction: Transaction;
  account: Account | undefined;
  categories: Category[];
  onClose: () => void;
  onChange: () => void;
}) {
  const initialDescription = cleanDescription(transaction.description);
  const [description, setDescription] = useState(initialDescription);
  const [categoryId, setCategoryId] = useState(transaction.category_id != null ? String(transaction.category_id) : "");
  const [deleting, setDeleting] = useState(false);

  async function saveDescription() {
    if (description === initialDescription) return;
    await api.updateTransaction(transaction.id, { description });
    onChange();
  }

  async function handleCategoryChange(value: string) {
    setCategoryId(value);
    await api.updateTransaction(transaction.id, { category_id: value ? Number(value) : null });
    onChange();
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteTransaction(transaction.id);
      onChange();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} aria-label="Close" style={{ padding: "0.3rem", display: "flex", background: "transparent", border: "none" }}>
            <X size={18} />
          </button>
        </div>

        <p className="modal__amount" style={{ color: transaction.amount >= 0 ? "var(--good)" : "var(--text-primary)" }}>
          {transaction.amount >= 0 ? "+" : ""}
          {formatCurrency(transaction.amount, transaction.currency)}
        </p>
        <span className="modal__type-badge">{transaction.amount >= 0 ? "Income" : "Spending"}</span>

        <div className="modal__field">
          <span className="modal__field-icon">
            <User size={16} />
          </span>
          <div className="modal__field-body">
            <div className="modal__field-label">Payee / description</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              style={{ width: "100%", padding: "0.3rem 0.5rem", fontSize: "0.92rem" }}
              placeholder="Add a description"
            />
          </div>
        </div>

        <div className="modal__field">
          <span className="modal__field-icon">
            <Tag size={16} />
          </span>
          <div className="modal__field-body">
            <div className="modal__field-label">Category</div>
            <select value={categoryId} onChange={(e) => handleCategoryChange(e.target.value)} style={{ width: "100%" }}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal__field">
          <span className="modal__field-icon">
            <Landmark size={16} />
          </span>
          <div className="modal__field-body">
            <div className="modal__field-label">Account</div>
            <div className="modal__field-value">{account?.name ?? "—"}</div>
          </div>
        </div>

        <div className="modal__field">
          <span className="modal__field-icon">
            <Calendar size={16} />
          </span>
          <div className="modal__field-body">
            <div className="modal__field-label">Date</div>
            <div className="modal__field-value">{transaction.booking_date}</div>
          </div>
        </div>

        <p className="page-header__subtitle" style={{ marginTop: "1rem", marginBottom: 0 }}>
          {SOURCE_LABEL[transaction.source]}
        </p>

        {transaction.source === "manual" && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              width: "100%",
              marginTop: "1.2rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              color: "var(--critical)",
              background: "transparent",
              border: "1px solid var(--border)",
            }}
          >
            <Trash2 size={14} />
            {deleting ? "Deleting…" : "Delete transaction"}
          </button>
        )}
      </div>
    </div>
  );
}
