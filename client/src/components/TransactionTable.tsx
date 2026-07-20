import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Account, Category, Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
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

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const list = byDate.get(tx.booking_date) ?? [];
      list.push(tx);
      byDate.set(tx.booking_date, list);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [transactions]);

  if (transactions.length === 0) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div>
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
                {tx.amount.toFixed(2)}
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
