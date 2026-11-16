import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type Category } from "../../api/client.js";
import { errorMessage } from "../../utils/errorMessage.js";

/**
 * One line, and it's recorded.
 *
 * The gap this closes is small and constant: noticing something is missing
 * while looking at the dashboard, and having to go to another page, find a
 * form and come back. Most of the time what needs adding is a date, an
 * amount, a word and an account, and that fits here.
 *
 * It deliberately does not try to be the full form. Splits, counterparties,
 * rules and categories that do not exist yet all belong on Transactions,
 * and a quick-add that grew those would be the same form in a smaller box.
 *
 * In and out are separate buttons rather than a sign the user has to get
 * right. A minus typed in the wrong place is the single easiest way to make
 * a ledger wrong, and it reads as correct afterwards.
 */

export default function QuickAdd({
  accounts,
  categories,
  onAdded,
}: {
  accounts: Account[];
  categories: Category[];
  onAdded: () => void;
}) {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const account = accountId || accounts[0]?.id;

  if (accounts.length === 0) {
    return (
      <p className="empty-state">
        Nothing to add to yet. <Link to="/accounts">Add an account</Link> first.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0 || !account) {
      setError("Enter an amount above zero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.createTransaction({
        account_id: account,
        booking_date: date,
        // The sign comes from the button, never from what was typed.
        amount: direction === "out" ? -Math.abs(value) : Math.abs(value),
        currency: accounts.find((a) => a.id === account)?.currency ?? "EUR",
        description: description.trim() || null,
        category_id: categoryId ? Number(categoryId) : null,
      });
      setAdded(`${direction === "out" ? "Paid" : "Received"} ${value.toFixed(2)}`);
      setAmount("");
      setDescription("");
      onAdded();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="quick-add">
      <div className="quick-add__direction" role="group" aria-label="Money in or out">
        {(["out", "in"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDirection(option)}
            aria-pressed={direction === option}
            data-active={direction === option ? option : undefined}
          >
            {option === "out" ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
            {option === "out" ? "Spent" : "Received"}
          </button>
        ))}
      </div>

      <div className="quick-add__row">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          aria-label="Amount"
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </div>

      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it?"
        aria-label="Description"
      />

      <div className="quick-add__row">
        <select value={account} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className="btn-accent" disabled={saving || !amount.trim()}>
        {saving ? <Loader2 size={13} className="spin" /> : null}
        {saving ? "Saving…" : direction === "out" ? "Record payment" : "Record income"}
      </button>

      {error && <p style={{ color: "var(--critical)", fontSize: "0.74rem", margin: 0 }}>{error}</p>}
      {added && !error && (
        <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", margin: 0 }}>
          {added} · <Link to="/transactions">see it on Transactions</Link>
        </p>
      )}
    </form>
  );
}
