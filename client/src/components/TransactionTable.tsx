import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Account, Category, Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import TransactionDetailModal from "./TransactionDetailModal.js";

function formatDateHeader(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: undefined, year: "numeric", month: "long", day: "numeric" });
}

export default function TransactionTable({
  transactions,
  categories,
  accounts,
  onChange,
}: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Only accounts that actually have transactions are worth offering, with
  // their counts — an account with nothing in it is a dead end in the dropdown.
  const countByAccount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) counts.set(tx.account_id, (counts.get(tx.account_id) ?? 0) + 1);
    return counts;
  }, [transactions]);
  const filterableAccounts = accounts.filter((a) => countByAccount.has(a.id));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (accountId && tx.account_id !== accountId) return false;
      if (!needle) return true;
      // Searches what's on screen plus the things you'd think to search by —
      // the account it's on and what it's filed under.
      return [
        tx.description,
        tx.counterparty,
        tx.booking_date,
        tx.amount.toFixed(2),
        accountsById.get(tx.account_id)?.name,
        tx.category_id != null ? categoryName.get(tx.category_id) : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [transactions, accountId, query, accountsById, categoryName]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const tx of visible) {
      const list = byDate.get(tx.booking_date) ?? [];
      list.push(tx);
      byDate.set(tx.booking_date, list);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  if (transactions.length === 0) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions…"
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
                {a.name} ({countByAccount.get(a.id)})
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
            style={{ fontSize: "0.78rem" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Says what's being looked at rather than leaving a short list to be
          mistaken for the whole history. */}
      {(query || accountId) && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
          {visible.length} of {transactions.length} shown
        </p>
      )}

      {visible.length === 0 && <p className="empty-state">Nothing matches that.</p>}

      {groups.map(([date, txs]) => (
        <div key={date}>
          <div className="date-group-header">{formatDateHeader(date)}</div>
          {txs.map((tx) => (
            <div className="tx-row tx-row--clickable" key={tx.id} onClick={() => setSelected(tx)}>
              <div className="tx-row__icon">
                {tx.amount >= 0 ? (
                  <ArrowDownRight size={15} color="var(--good)" />
                ) : (
                  <ArrowUpRight size={15} color="var(--text-muted)" />
                )}
              </div>
              <div className="tx-row__info">
                <div className="tx-row__name">{cleanDescription(tx.description) || accountsById.get(tx.account_id)?.name || "Transaction"}</div>
              </div>
              <span className={`tx-row__amount${tx.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
                {tx.amount >= 0 ? "+" : ""}
                {formatCurrency(tx.amount, tx.currency)}
              </span>
            </div>
          ))}
        </div>
      ))}

      {selected && (
        <TransactionDetailModal
          key={selected.id}
          transaction={selected}
          account={accountsById.get(selected.account_id)}
          categories={categories}
          onClose={() => setSelected(null)}
          onChange={() => {
            onChange();
            // Keep the modal's own view of the transaction fresh (e.g. after
            // changing its category) without needing the parent's refreshed
            // `transactions` prop to have landed yet.
            setSelected((prev) => (prev ? transactions.find((t) => t.id === prev.id) || prev : prev));
          }}
        />
      )}
    </div>
  );
}
