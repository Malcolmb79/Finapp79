import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Account, Category, Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import TransactionDetailModal from "./TransactionDetailModal.js";

function formatDateHeader(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: undefined, year: "numeric", month: "long", day: "numeric" });
}

/** Sentinel for "has no category" — distinct from "" , which is no filter. */
const UNCATEGORISED = "none";

/**
 * Names the date window in the words the figure that set it would use.
 *
 * A whole calendar month says the month's name, because that is what was
 * clicked on a cash flow bar — "1–31 Mar" is the same span described worse.
 */
function dateWindowLabel(from: string, to: string): string {
  const month = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  if (from && to) {
    const lastOfMonth = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0).getDate();
    const wholeMonth = from.slice(8) === "01" && from.slice(0, 7) === to.slice(0, 7) && Number(to.slice(8)) === lastOfMonth;
    if (wholeMonth) return month(from);
    return `${day(from)} – ${day(to)}`;
  }
  return from ? `From ${day(from)}` : `Up to ${day(to)}`;
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
  /**
   * The filters live in the URL rather than in component state.
   *
   * That makes every "show me what is behind this number" elsewhere in the
   * app a plain link — /transactions?category=none is the uncategorised pile
   * — instead of each place needing its own drilled-down screen. It also
   * means a filtered view survives a refresh and can be sent to someone.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get("account") ?? "";
  const query = searchParams.get("q") ?? "";
  /**
   * An inclusive booking-date window, as two ISO dates.
   *
   * Every figure that describes a period — a month's spending on a cash flow
   * bar, a budget's spend so far — needs this to drill into, because without
   * it the list that opens covers a different span than the number clicked and
   * adds up to something else. A window is set by a link rather than by a
   * control here: it arrives already matching the figure it came from.
   */
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  // Replace, not push: changing a filter is adjusting the current view, not
  // a new place. Otherwise Back walks keystroke by keystroke through a
  // search box rather than returning where you came from.
  function setFilter(key: string, value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  }

  const setAccountId = (value: string) => setFilter("account", value);
  const setQuery = (value: string) => setFilter("q", value);
  // "" is every category; UNCATEGORISED is the rows with none, which is a
  // real thing to look for rather than the absence of a filter — it is how
  // you find what still needs filing.
  const categoryFilter = searchParams.get("category") ?? "";
  const setCategoryFilter = (value: string) => setFilter("category", value);

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

  // Same reasoning as the accounts above: only categories that actually have
  // transactions are worth offering. Uncategorised is counted alongside them,
  // since "nothing filed yet" is the most useful of these to pick.
  const { countByCategory, uncategorisedCount } = useMemo(() => {
    const counts = new Map<number, number>();
    let none = 0;
    for (const tx of transactions) {
      if (tx.category_id == null) none++;
      else counts.set(tx.category_id, (counts.get(tx.category_id) ?? 0) + 1);
    }
    return { countByCategory: counts, uncategorisedCount: none };
  }, [transactions]);
  const filterableCategories = categories.filter((c) => countByCategory.has(c.id));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (accountId && tx.account_id !== accountId) return false;
      // Both ends inclusive: a window of a calendar month is written as its
      // first and last day, and an exclusive end would quietly drop the 31st.
      if (from && tx.booking_date < from) return false;
      if (to && tx.booking_date > to) return false;
      if (categoryFilter === UNCATEGORISED) {
        if (tx.category_id != null) return false;
      } else if (categoryFilter && tx.category_id !== Number(categoryFilter)) {
        return false;
      }
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
  }, [transactions, accountId, categoryFilter, query, from, to, accountsById, categoryName]);

  const filtered = Boolean(query || accountId || categoryFilter || from || to);

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
        {(filterableCategories.length > 0 || uncategorisedCount > 0) && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ fontSize: "0.82rem", maxWidth: 170 }}
            aria-label="Filter by category"
          >
            <option value="">All categories ({transactions.length})</option>
            {uncategorisedCount > 0 && (
              <option value={UNCATEGORISED}>Uncategorized ({uncategorisedCount})</option>
            )}
            {filterableCategories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name} ({countByCategory.get(c.id)})
              </option>
            ))}
          </select>
        )}
        {/* The window has no control of its own — it arrives on a link from
            whatever figure was clicked. So it is shown as a chip that can be
            dropped, rather than filtering the list with nothing on screen
            saying so. */}
        {(from || to) && (
          <button
            // Both ends in one call. Two successive setSearchParams updaters
            // are batched and each is handed the same pre-update params, so
            // the second overwrites the first's result and one end survives.
            onClick={() =>
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("from");
                  next.delete("to");
                  return next;
                },
                { replace: true }
              )
            }
            title="Show every date"
            style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
          >
            {dateWindowLabel(from, to)}
            <X size={12} />
          </button>
        )}
        {filtered && (
          <button
            onClick={() =>
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  for (const key of ["q", "account", "category", "from", "to"]) next.delete(key);
                  return next;
                },
                { replace: true }
              )
            }
            style={{ fontSize: "0.78rem" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Says what's being looked at rather than leaving a short list to be
          mistaken for the whole history. */}
      {filtered && (
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
                {/* The category, on the row rather than only inside the
                    detail card. It is the thing most often being checked when
                    somebody scans this list, and opening every row in turn to
                    find the one that is filed wrong is how it stays wrong.
                    Uncategorised says so rather than showing a blank, because
                    a blank reads as a category whose name didn't load. */}
                <div className="tx-row__meta">
                  {tx.category_id != null ? categoryName.get(tx.category_id) ?? "Uncategorised" : "Uncategorised"}
                </div>
              </div>
              <span className={`tx-row__amount${tx.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
                {tx.amount >= 0 ? "+" : ""}
                {formatCurrency(tx.amount, tx.currency)}
              </span>
            </div>
          ))}
        </div>
      ))}

      {/* `siblings` is the whole list, not just what the filters leave
          visible: fixing a merchant means fixing it everywhere, and a count
          that silently stopped at the current filter would understate what
          the change is about to do. */}
      {selected && (
        <TransactionDetailModal
          key={selected.id}
          transaction={selected}
          account={accountsById.get(selected.account_id)}
          categories={categories}
          siblings={transactions}
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
