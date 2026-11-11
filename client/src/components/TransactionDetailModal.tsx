import { Calendar, Landmark, Layers, Sparkles, Tag, Trash2, User, X } from "lucide-react";
import { useState } from "react";
import { api, type Account, type Category, type Transaction } from "../api/client.js";
import CategorySelect from "./CategorySelect.js";
import SplitEditor from "./SplitEditor.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { matchKey, merchantLabel, similarTransactions } from "../utils/similarTransactions.js";

const SOURCE_LABEL: Record<Transaction["source"], string> = {
  enablebanking: "Synced from bank",
  manual: "Manual entry",
  csv: "CSV import",
};

export default function TransactionDetailModal({
  transaction,
  account,
  categories,
  siblings = [],
  onClose,
  onChange,
}: {
  transaction: Transaction;
  account: Account | undefined;
  categories: Category[];
  /**
   * The other transactions on screen, so a change here can be offered for the
   * rest of the merchant. Empty where the caller has no list to give, and the
   * offer simply doesn't appear.
   */
  siblings?: Transaction[];
  onClose: () => void;
  onChange: () => void;
}) {
  const initialDescription = cleanDescription(transaction.description);
  const [description, setDescription] = useState(initialDescription);
  const [categoryId, setCategoryId] = useState(transaction.category_id != null ? String(transaction.category_id) : "");
  const [deleting, setDeleting] = useState(false);

  /**
   * The merchant as it was when this opened, captured once.
   *
   * It has to be the name *before* any edit: rename "VDP-MGP*Vinted" to
   * "Vinted" and the new name no longer matches the rows still carrying the
   * old one, which are precisely the rows being offered.
   */
  const [key] = useState(() => matchKey(transaction));

  /** The change just made, and the rows it could still be applied to. */
  const [offer, setOffer] = useState<{ patch: { category_id?: number | null; description?: string }; rows: Transaction[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  function proposeFor(change: { categoryId?: number | null; description?: string }, patch: { category_id?: number | null; description?: string }) {
    const rows = similarTransactions(siblings, transaction, key, change);
    setApplied(null);
    setOffer(rows.length > 0 ? { patch, rows } : null);
  }

  const [suggesting, setSuggesting] = useState(false);
  /** What came back: nothing to go on, or the category it is already in. */
  const [suggestion, setSuggestion] = useState<"none" | "same" | null>(null);
  /** A different category it suggests, waiting to be accepted or declined. */
  const [proposed, setProposed] = useState<number | null>(null);

  /**
   * Files it where the suggestion says, rather than only naming the category.
   *
   * Showing "we think Groceries" and leaving the picker untouched would make
   * agreeing with it the same number of clicks as not asking at all. The
   * change is applied, and the usual offer to apply it to the rest of the
   * merchant follows — so one click can file every transaction from it.
   */
  async function suggest() {
    setSuggesting(true);
    setSuggestion(null);
    setProposed(null);
    try {
      const { category_id } = await api.suggestCategoryFor(transaction.id);
      if (category_id == null) {
        setSuggestion("none");
        return;
      }
      if (String(category_id) === categoryId) {
        setSuggestion("same");
        return;
      }
      // Nothing filed yet: nothing to lose by applying it, and agreeing with
      // a suggestion should not cost a second click.
      if (categoryId === "") {
        await handleCategoryChange(String(category_id));
        return;
      }
      // Already filed, and somewhere else. That was very likely a decision,
      // so it is proposed rather than overwritten — a suggestion that
      // silently replaced a deliberate choice would make the button
      // dangerous to press.
      setProposed(category_id);
    } finally {
      setSuggesting(false);
    }
  }

  async function applyToRest() {
    if (!offer) return;
    setApplying(true);
    try {
      const { updated } = await api.bulkUpdateTransactions(
        offer.rows.map((row) => row.id),
        offer.patch
      );
      setApplied(updated);
      setOffer(null);
      onChange();
    } finally {
      setApplying(false);
    }
  }

  async function saveDescription() {
    if (description === initialDescription) return;
    await api.updateTransaction(transaction.id, { description });
    proposeFor({ description }, { description });
    onChange();
  }

  async function handleCategoryChange(value: string) {
    setCategoryId(value);
    const category_id = value ? Number(value) : null;
    await api.updateTransaction(transaction.id, { category_id });
    proposeFor({ categoryId: category_id }, { category_id });
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
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
              <CategorySelect
                categories={categories}
                value={categoryId === "" ? null : Number(categoryId)}
                onChange={(id) => handleCategoryChange(id == null ? "" : String(id))}
                width={220}
              />
              {/* Only while it is unfiled, and only on a click. The review
                  queue has suggested a category for a long time; a
                  transaction opened on its own got nothing, so the one place
                  somebody goes *because* they want to file something was the
                  one place that wouldn't help. A click rather than a fetch on
                  open, so looking at a transaction never quietly costs a
                  model call. */}
              <button type="button" onClick={suggest} disabled={suggesting} style={{ fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}>
                <Sparkles size={13} style={{ marginRight: "0.25rem", verticalAlign: "-2px" }} />
                {suggesting ? "Thinking…" : categoryId === "" ? "Suggest" : "Check"}
              </button>
            </div>

            {suggestion === "none" && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Nothing to go on yet — file a few of these by hand and it will learn where they belong.
              </p>
            )}

            {suggestion === "same" && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Already where it would have put it.
              </p>
            )}

            {/* A different category, proposed rather than applied. The one it
                is in was very likely a decision, and a button that silently
                replaced a deliberate choice would be dangerous to press. */}
            {proposed != null && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap", margin: "0.4rem 0 0" }}>
                <span style={{ fontSize: "0.78rem" }}>
                  Looks more like <strong>{categories.find((c) => c.id === proposed)?.name ?? "something else"}</strong>.
                </span>
                <button
                  type="button"
                  className="btn-accent"
                  style={{ fontSize: "0.76rem", padding: "0.25rem 0.5rem" }}
                  onClick={async () => {
                    const id = proposed;
                    setProposed(null);
                    await handleCategoryChange(String(id));
                  }}
                >
                  Move it
                </button>
                <button type="button" style={{ fontSize: "0.76rem", padding: "0.25rem 0.5rem" }} onClick={() => setProposed(null)}>
                  Leave it
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Offered after the change, never before it. The one row the person
            opened is already saved, so this asks about the rest rather than
            standing between them and the edit they came to make. The count is
            the number of rows that will really change — rows already holding
            the new value are excluded, because "apply to 40" that quietly
            changes three teaches people to distrust the number. */}
        {offer && (
          <div
            style={{
              margin: "0.6rem 0 0",
              padding: "0.55rem 0.7rem",
              border: "1px solid var(--border)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            <Layers size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: "0.8rem", flex: 1, minWidth: 180 }}>
              {offer.rows.length} other {offer.rows.length === 1 ? "transaction" : "transactions"} from{" "}
              <strong>{merchantLabel(transaction)}</strong>
              {offer.patch.description !== undefined ? " can take this name too." : " can be filed here too."}
            </span>
            <button onClick={applyToRest} disabled={applying} className="btn-accent" style={{ fontSize: "0.78rem" }}>
              {applying ? "Applying…" : `Apply to ${offer.rows.length}`}
            </button>
            <button onClick={() => setOffer(null)} disabled={applying} style={{ fontSize: "0.78rem" }}>
              Just this one
            </button>
          </div>
        )}

        {applied != null && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Updated {applied} other {applied === 1 ? "transaction" : "transactions"}.
          </p>
        )}

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
