import { Check, ChevronRight, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { api, type Account, type Category, type PendingTransaction } from "../../api/client.js";
import { errorMessage } from "../../utils/errorMessage.js";
import CategorySelect from "../CategorySelect.js";
import TransactionDetailModal from "../TransactionDetailModal.js";
import { cleanDescription } from "../../utils/cleanDescription.js";
import { formatCurrency } from "../../utils/formatCurrency.js";

// Per-row category choice starts at the suggested category but the user can
// override it before approving — a row only gets an entry in `selections`
// once the user actually changes its dropdown, so any untouched row falls
// back to its suggestion without needing to pre-seed state from an effect.
export default function PendingReviewWidget({
  transactions,
  categories,
  accounts = [],
  onApproved,
}: {
  transactions: PendingTransaction[];
  categories: Category[];
  /** Enables the account filter, and names the account on each row. */
  accounts?: Account[];
  onApproved: () => void;
}) {
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [proposed, setProposed] = useState<string[]>([]);
  // The categories the dropdowns offer: the prop, plus any created inline here
  // before the parent has refetched (see the `setKnown` below).
  const [known, setKnown] = useState<Category[]>(categories);
  const [lastCategories, setLastCategories] = useState(categories);
  /**
   * Which row is open in the detail card, held as an id rather than the row.
   *
   * A row here carries almost nothing on its face — some arrive from the bank
   * with no description at all, and then the line reads "Transaction" and a
   * date, which answers none of the questions somebody filing it actually
   * has: which account, what the bank really sent, is this one of a pair.
   *
   * Holding the id rather than the object means the card reads the refreshed
   * list on every change instead of the copy it was handed when it opened,
   * and it closes by itself if the row stops waiting.
   */
  const [openId, setOpenId] = useState<string | null>(null);

  // Adjusting state during render — React's documented pattern for "reset
  // state when a prop changes" — rather than in an effect, which rendered the
  // whole list once with the stale set before correcting it. Same reasoning as
  // the drawer reset in App.tsx. A locally added category survives until the
  // parent sends a new list, which by then contains it.
  if (categories !== lastCategories) {
    setLastCategories(categories);
    setKnown(categories);
  }

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
      // The server says why it had nothing, so the button can never again
      // just swallow a click and look broken.
      const applied = result.suggestions.filter((s) => s.categoryId != null || s.proposedCategory).length;
      // Only claim "nothing new" when there were actually rows to look at —
      // with none, the server already returns a null note and saying every
      // row is categorised would be a statement about an empty list.
      const nothingNew = result.suggestions.length > 0 && applied === 0;
      setSuggestNote(result.note ?? (nothingNew ? "Nothing new to suggest — every row already has a category." : null));
    } catch (err) {
      setSuggestNote(errorMessage(err, "Couldn't get suggestions just then."));
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

  /**
   * What this row will be filed as when it is approved.
   *
   * A category already on the row outranks the suggestion. The only way one
   * gets there before approval is somebody setting it by hand in the detail
   * card, and letting a suggestion win would quietly undo that edit on the
   * very next click — approving would file it somewhere else than the screen
   * had just been told.
   */
  function selectedCategory(t: PendingTransaction): number | null {
    if (t.id in selections) return selections[t.id];
    return t.category_id ?? t.suggested_category_id;
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

  // Bulk actions deliberately operate on the filtered set, not everything:
  // the search is how you choose what to act on, so "approve all" while a
  // filter is active must mean the rows you can see.
  const needle = query.trim().toLowerCase();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const visible = transactions.filter((t) => {
    if (accountId && t.account_id !== accountId) return false;
    if (!needle) return true;
    return [t.description, t.counterparty, t.booking_date, t.amount.toFixed(2), accountName.get(t.account_id)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });

  // Only accounts with something waiting are worth offering, with their
  // counts — an account with nothing pending is a dead end in the dropdown.
  const pendingByAccount = new Map<string, number>();
  for (const t of transactions) pendingByAccount.set(t.account_id, (pendingByAccount.get(t.account_id) ?? 0) + 1);
  const filterableAccounts = accounts.filter((a) => pendingByAccount.has(a.id));

  async function approveVisible() {
    setApprovingAll(true);
    try {
      await api.bulkApproveTransactions(visible.map((t) => ({ id: t.id, category_id: selectedCategory(t) })));
      onApproved();
    } finally {
      setApprovingAll(false);
    }
  }

  function categoriseVisible(categoryId: number | null) {
    setSelections((current) => {
      const next = { ...current };
      for (const t of visible) next[t.id] = categoryId;
      return next;
    });
  }

  // Read back out of the live list rather than stored, so an edit made in
  // the card shows up the moment the parent refetches.
  const open = openId ? transactions.find((t) => t.id === openId) ?? null : null;

  if (transactions.length === 0) {
    return <p className="empty-state">No new transactions to review.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <Search size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          value={query}
          placeholder="Search description, payee, date or amount"
          onChange={(e) => setQuery(e.target.value)}
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
                {a.name} ({pendingByAccount.get(a.id)})
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
            aria-label="Clear filters"
            title="Clear filters"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginRight: "auto" }}>
          {visible.length === transactions.length
            ? `${transactions.length} awaiting review`
            : `${visible.length} of ${transactions.length} shown`}
          {/* Said once here when everything waiting is on the same account.
              The per-row label is suppressed in that case — it would be the
              same word on every line — which left "which account is this?"
              unanswered anywhere on the screen. */}
          {filterableAccounts.length === 1 && ` in ${filterableAccounts[0].name}`}
        </span>

        {/* Sets a category on every visible row at once — the point of
            searching for, say, "tesco" and filing the lot in one go. */}
        <CategorySelect
          categories={known}
          value={null}
          onChange={(id) => categoriseVisible(id)}
          onCreate={createCategory}
          placeholder={visible.length === transactions.length ? "Set all to…" : `Set ${visible.length} to…`}
          width={150}
        />

        <button onClick={suggestAll} disabled={suggesting}>
          {suggesting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          Suggest
        </button>
        <button className="btn-accent" onClick={approveVisible} disabled={approvingAll || visible.length === 0}>
          <Check size={14} />
          Approve {visible.length === transactions.length ? "all" : visible.length}
        </button>
      </div>

      {/* The reason nothing came back. Without this the button answered a
          click with no visible change, which reads as broken rather than as
          "there is nothing to suggest" or "the server has no API key". */}
      {suggestNote && (
        <p role="status" style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
          {suggestNote}
        </p>
      )}

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
      {visible.length === 0 && <p className="empty-state">No transactions match “{query.trim()}”.</p>}

      {visible.map((t) => (
        <div className="tx-row tx-row--review" key={t.id}>
          {/* Opens the full card. A real button, so the keyboard and a
              screen reader get it too, and the payee block is the part of the
              row not already spoken for by a control. */}
          <button
            type="button"
            className="tx-row__info tx-row__open"
            onClick={() => setOpenId(t.id)}
            aria-label={`Open ${cleanDescription(t.description) || t.counterparty || "this transaction"} for the account, date and full bank text`}
          >
            {/* Same cleaning the transactions table does, and titled so the
                full bank text is still reachable when the row clips it. */}
            <div className="tx-row__name" title={t.description ?? undefined}>
              <span className="tx-row__name-text">
                {cleanDescription(t.description) || t.counterparty || "Transaction"}
              </span>
              <ChevronRight size={13} className="tx-row__open-hint" aria-hidden="true" />
            </div>
            <div className="tx-row__meta">
              {t.booking_date}
              {/* Named only when more than one account has rows waiting —
                  otherwise it's the same word on every line. */}
              {filterableAccounts.length > 1 && accountName.has(t.account_id) && ` · ${accountName.get(t.account_id)}`}
              {/* A rule is marked too, and for the opposite reason to the AI
                  badge: that one says check this, this one says you already
                  decided this — which is what makes it safe to approve
                  without reading. */}
              {t.suggestion_source === "rule" && !(t.id in selections) && (
                <span
                  title="Filed by one of your rules"
                  style={{
                    marginLeft: "0.4rem",
                    padding: "0.05rem 0.3rem",
                    borderRadius: 4,
                    fontSize: "0.7rem",
                    background: "color-mix(in srgb, var(--good) 18%, transparent)",
                    color: "var(--good)",
                  }}
                >
                  Rule
                </span>
              )}
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
          </button>
          <CategorySelect
            categories={known}
            value={selectedCategory(t)}
            onChange={(id) => setSelections((s) => ({ ...s, [t.id]: id }))}
            onCreate={createCategory}
            width={130}
          />
          <span className={`tx-row__amount${t.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
            {t.amount >= 0 ? "+" : ""}
            {formatCurrency(t.amount, t.currency)}
          </span>
          <button className="icon-button" aria-label="Approve" onClick={() => approve(t)} disabled={approvingId === t.id}>
            <Check size={15} />
          </button>
        </div>
      ))}

      {/* The same card the transactions table and the dashboard open, so a
          transaction looks and behaves the same wherever it is clicked.
          Setting a category in it does not approve the row — approving is
          still the tick on the row, and the card's choice arrives in the
          dropdown as the decision already made. `siblings` is everything
          waiting rather than the filtered view, because fixing a merchant
          means fixing it everywhere. */}
      {open && (
        <TransactionDetailModal
          key={open.id}
          transaction={open}
          account={accounts.find((a) => a.id === open.account_id)}
          categories={known}
          siblings={transactions}
          onClose={() => setOpenId(null)}
          onChange={onApproved}
        />
      )}
    </div>
  );
}
