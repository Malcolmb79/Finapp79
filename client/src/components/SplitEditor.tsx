import { Loader2, Plus, Split as SplitIcon, X } from "lucide-react";
import { useState } from "react";
import { api, type Category, type Transaction } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { splitRemainder, splitsBalance } from "../utils/splits.js";

/**
 * One payment across several categories.
 *
 * The reason this exists is correctness, not convenience: a supermarket shop
 * that was half groceries and half a birthday present has no honest single
 * category, and the choice without it is to file it wrong or leave it unfiled.
 * Both put a figure in a budget that is not true.
 *
 * The running remainder is the whole interface. Splitting is arithmetic done
 * at a kitchen table against a receipt, and the question at every moment is
 * "how much is left to account for" — so that figure is on screen and the save
 * is refused until it is zero.
 */

interface Part {
  categoryId: string;
  amount: string;
}

function toParts(transaction: Transaction): Part[] {
  const existing = transaction.splits;
  if (existing && existing.length > 0) {
    return existing.map((split) => ({
      categoryId: split.category_id == null ? "" : String(split.category_id),
      amount: String(split.amount),
    }));
  }
  // Opening a fresh split: the first part carries the transaction's own
  // category and the whole amount, so the first thing typed is how much to
  // take *off* it rather than a form of blanks to fill from nothing.
  return [
    { categoryId: transaction.category_id == null ? "" : String(transaction.category_id), amount: String(transaction.amount) },
    { categoryId: "", amount: "" },
  ];
}

export default function SplitEditor({
  transaction,
  categories,
  onChanged,
}: {
  transaction: Transaction;
  categories: Category[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(Boolean(transaction.splits?.length));
  const [parts, setParts] = useState<Part[]>(() => toParts(transaction));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amounts = parts.map((part) => Number(part.amount.trim().replace(/[,\s]/g, "")) || 0);
  const remainder = splitRemainder(transaction.amount, amounts);
  const balanced = splitsBalance(transaction.amount, amounts);

  function update(index: number, patch: Partial<Part>) {
    setParts((current) => current.map((part, i) => (i === index ? { ...part, ...patch } : part)));
  }

  /**
   * A new part takes whatever is still unaccounted for. That is almost always
   * the right number, and when it isn't it is the right starting point.
   */
  function addPart() {
    setParts((current) => [...current, { categoryId: "", amount: remainder !== 0 ? String(Number(remainder.toFixed(2))) : "" }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setSplits(
        transaction.id,
        parts.map((part, i) => ({ category_id: part.categoryId ? Number(part.categoryId) : null, amount: amounts[i] }))
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that split.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSplit() {
    setSaving(true);
    setError(null);
    try {
      await api.setSplits(transaction.id, []);
      setOpen(false);
      setParts(toParts({ ...transaction, splits: null }));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo that split.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          fontSize: "0.78rem",
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--accent)",
          cursor: "pointer",
        }}
      >
        <SplitIcon size={13} /> Split across categories
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      {parts.map((part, i) => (
        <div key={i} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
          <select
            value={part.categoryId}
            onChange={(e) => update(i, { categoryId: e.target.value })}
            aria-label={`Category for part ${i + 1}`}
            style={{ fontSize: "0.8rem", flex: 1 }}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={part.amount}
            onChange={(e) => update(i, { amount: e.target.value })}
            inputMode="decimal"
            aria-label={`Amount for part ${i + 1}`}
            style={{ width: 100, fontSize: "0.8rem", padding: "0.2rem 0.35rem" }}
          />
          {parts.length > 2 && (
            <button
              onClick={() => setParts((current) => current.filter((_, j) => j !== i))}
              aria-label={`Remove part ${i + 1}`}
              style={{ padding: "0.15rem", display: "flex" }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.78rem" }}>
        <button onClick={addPart} style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <Plus size={12} /> Part
        </button>
        {/* The running question, answered at every keystroke. */}
        <span style={{ color: balanced ? "var(--good)" : "var(--critical)" }}>
          {balanced
            ? "Adds up"
            : `${formatCurrency(Math.abs(remainder), transaction.currency)} ${remainder > 0 === transaction.amount > 0 ? "still to account for" : "over"}`}
        </span>
        <button onClick={save} disabled={saving || !balanced} className="btn-accent" style={{ fontSize: "0.78rem" }}>
          {saving ? <Loader2 size={12} className="spin" /> : "Save split"}
        </button>
        {transaction.splits?.length ? (
          <button onClick={removeSplit} disabled={saving} style={{ fontSize: "0.78rem" }}>
            Undo split
          </button>
        ) : (
          <button onClick={() => setOpen(false)} disabled={saving} style={{ fontSize: "0.78rem" }}>
            Cancel
          </button>
        )}
      </div>

      {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: 0 }}>{error}</p>}
    </div>
  );
}
