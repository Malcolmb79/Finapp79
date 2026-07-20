import { Bell, Menu, Search, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PendingTransaction } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { initials } from "../../utils/avatarColor.js";
import ThemeToggle from "../ThemeToggle.js";

export default function TopHeader({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.listPendingTransactions().then(setPending);
  }, []);

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
      <div className="search-input" style={{ position: "relative" }}>
        <Search
          size={15}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
        />
        <input type="search" placeholder="Search..." style={{ width: "100%", paddingLeft: "2rem" }} disabled />
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
              <div className="add-widget-menu" style={{ width: 300 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", padding: "0.3rem 0.5rem 0.5rem" }}>New transactions</div>
                {pending.length === 0 ? (
                  <p className="empty-state" style={{ padding: "0 0.5rem 0.4rem" }}>
                    Nothing to review.
                  </p>
                ) : (
                  <>
                    {pending.slice(0, 8).map((t) => (
                      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "0.4rem 0.5rem" }}>
                        <span style={{ fontSize: "0.83rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.description || t.counterparty || "Transaction"}
                        </span>
                        <span style={{ fontSize: "0.83rem", fontWeight: 600, whiteSpace: "nowrap" }}>{t.amount.toFixed(2)}</span>
                      </div>
                    ))}
                    <button
                      className="add-widget-menu__item"
                      style={{ justifyContent: "center", fontWeight: 600, marginTop: "0.3rem" }}
                      onClick={() => {
                        setOpen(false);
                        navigate("/");
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
