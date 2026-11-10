import { Calendar, Landmark, Tag, Trash2, User, X } from "lucide-react";
import { useState } from "react";
import { api, type Account, type Category, type Transaction } from "../api/client.js";
import CategorySelect from "./CategorySelect.js";
import SplitEditor from "./SplitEditor.js";
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

  // The backdrop dismisses on pointerdown rather than click, and only when the
  // press started on the backdrop itself. The category picker inside commits
  // on pointerdown and unmounts immediately, so the click that follows lands
  // on the backdrop — a click handler here would read that as the user
  // dismissing the modal and close it mid-selection.
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
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
            {/* What the bank actually sent, whenever the tidied name differs.
                The cleaning is aggressive — it drops card-scheme prefixes,
                IBANs, mandate references and FX conversions — and that is only
                safe while the original stays readable somewhere. It is also
                the answer to "why is it called that?", which has no other
                answer once the name on the row is not the bank's. */}
            {transaction.description && transaction.description.trim() !== description.trim() && (
              <div
                style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.3rem", wordBreak: "break-word" }}
                title="Exactly what the bank sent"
              >
                From the bank: {transaction.description}
              </div>
            )}
          </div>
        </div>

        <div className="modal__field">
          <span className="modal__field-icon">
            <Tag size={16} />
          </span>
          <div className="modal__field-body">
            <div className="modal__field-label">Category</div>
            <CategorySelect
              categories={categories}
              value={categoryId === "" ? null : Number(categoryId)}
              onChange={(id) => handleCategoryChange(id == null ? "" : String(id))}
              width={220}
            />
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

        {/* Under the category, because it is the same question asked more
            finely: not which one, but how much of each. */}
        <div style={{ marginTop: "0.9rem" }}>
          <SplitEditor transaction={transaction} categories={categories} onChanged={onChange} />
        </div>

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
