import { Bell, Menu, Search, User } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext.js";
import { initials } from "../../utils/avatarColor.js";
import ThemeToggle from "../ThemeToggle.js";

export default function TopHeader({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth();

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
        <button className="icon-button" aria-label="Notifications" disabled>
          <Bell size={17} />
        </button>
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
