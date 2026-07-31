import { Bell, Menu, User, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Account, type Category, type PendingTransaction } from "../../api/client.js";
import { useAccountScope } from "../../contexts/AccountScopeContext.js";
import { visibleAccounts } from "../../utils/accountBalance.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { initials } from "../../utils/avatarColor.js";
import { cleanDescription } from "../../utils/cleanDescription.js";
import { formatCurrency } from "../../utils/formatCurrency.js";
import CategorySelect from "../CategorySelect.js";
import { Check } from "lucide-react";
import ThemeToggle from "../ThemeToggle.js";

export default function TopHeader({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  // Only rows the user has actually changed; anything untouched keeps its
  // suggestion, the same rule the review widget uses.
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [approving, setApproving] = useState<string | null>(null);
  const { scope, setScope } = useAccountScope();
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    api.listPendingTransactions().then(setPending);
    api.listCategories().then(setCategories);
    // A remembered filter naming an account that no longer exists would leave
    // every page empty with nothing on screen to explain it, so it is checked
    // against the real list once and dropped if it has gone.
    api.listAccounts().then((list) => {
      setAccounts(list);
      setScope((current) => (current && !list.some((a) => a.id === current) ? null : current));
    });
    // Runs once: setScope is stable and the check only matters at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden accounts aren't offered as a filter — they count towards nothing,
  // so picking one would be asking for a view of an account you have already
  // said shouldn't appear.
  const selectable = visibleAccounts(accounts);

  function chosen(t: PendingTransaction): number | null {
    return t.id in selections ? selections[t.id] : t.suggested_category_id;
  }

  async function approve(t: PendingTransaction) {
    setApproving(t.id);
    try {
      await api.approveTransaction(t.id, chosen(t));
      setPending((current) => current.filter((other) => other.id !== t.id));
    } finally {
      setApproving(null);
    }
  }

  // The server matches case-insensitively and returns the existing category
  // rather than creating a duplicate, so this is safe to call repeatedly.
  async function createCategory(name: string) {
    const category = await api.createCategory(name.trim());
    setCategories((current) =>
      current.some((c) => c.id === category.id) ? current : [...current, category].sort((a, b) => a.name.localeCompare(b.name))
    );
    return category;
  }

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next) api.listPendingTransactions().then(setPending);
      return next;
    });
  }

  return (
    <header className="top-header">
      <button className="icon-button menu-button" aria-label="Open navigation" onClick={onOpenNav}>
        <Menu size={18} />
      </button>
      {/* Scopes every page at once: pick an account and the dashboard,
          analytics and debt views all narrow to it. Kept in the header rather
          than repeated per page so there is one filter to notice and one to
          clear — a per-page filter left on somewhere else is how figures end
          up looking wrong for no visible reason. */}
      <div className="search-input" style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Wallet size={15} style={{ color: scope ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }} />
        <select
          value={scope ?? ""}
          onChange={(e) => setScope(e.target.value || null)}
          aria-label="Filter every view to one account"
          title="Filter every view to one account"
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            fontSize: "0.85rem",
            fontWeight: scope ? 600 : 400,
            color: scope ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          <option value="">All accounts</option>
          {selectable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {scope && (
          <button
            className="icon-button"
            onClick={() => setScope(null)}
            aria-label="Show all accounts again"
            title="Show all accounts again"
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="top-header__actions">
        <ThemeToggle />
        <div style={{ position: "relative" }}>
          <button className="icon-button" aria-label="Notifications" onClick={toggle} aria-expanded={open}>
            <Bell size={17} />
            {pending.length > 0 && <span className="notification-badge">{pending.length > 9 ? "9+" : pending.length}</span>}
          </button>
          {open && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
              <div className="add-widget-menu" style={{ width: 340 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", padding: "0.3rem 0.5rem 0.5rem" }}>New transactions</div>
                {pending.length === 0 ? (
                  <p className="empty-state" style={{ padding: "0 0.5rem 0.4rem" }}>
                    Nothing to review.
                  </p>
                ) : (
                  <>
                    {/* Filed from here rather than only listed: the notification
                        is where a new transaction is noticed, and sending
                        someone to another page to categorise it is a trip for
                        something that fits in the row it is already in. */}
                    {pending.slice(0, 8).map((t) => (
                      <div key={t.id} style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--gridline)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem" }}>
                          <span
                            title={t.description ?? undefined}
                            style={{ fontSize: "0.83rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {cleanDescription(t.description) || t.counterparty || "Transaction"}
                          </span>
                          <span style={{ fontSize: "0.83rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {formatCurrency(t.amount, t.currency)}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.3rem" }}>
                          <CategorySelect
                            categories={categories}
                            value={chosen(t)}
                            onChange={(id) => setSelections((current) => ({ ...current, [t.id]: id }))}
                            onCreate={createCategory}
                            width={200}
                          />
                          <button
                            className="icon-button"
                            aria-label={`Approve ${cleanDescription(t.description) || "transaction"}`}
                            title="Approve"
                            onClick={() => approve(t)}
                            disabled={approving === t.id}
                          >
                            <Check size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      className="add-widget-menu__item"
                      style={{ justifyContent: "center", fontWeight: 600, marginTop: "0.3rem" }}
                      onClick={() => {
                        setOpen(false);
                        // The transactions page, not the dashboard: this was
                        // pointing at "/" and did nothing at all when opened
                        // from the dashboard, which is where it is usually
                        // opened from. The review widget lives on both, but
                        // only one of them is somewhere else.
                        navigate("/transactions");
                      }}
                    >
                      Review all
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt={user.name ?? "Account"} className="avatar-chip" referrerPolicy="no-referrer" />
        ) : (
          <div className="avatar-chip" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {user?.name ? initials(user.name) : <User size={17} />}
          </div>
        )}
      </div>
    </header>
  );
}
