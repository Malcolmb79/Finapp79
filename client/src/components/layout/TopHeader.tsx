import { Bell, Search, User } from "lucide-react";
import ThemeToggle from "../ThemeToggle.js";

export default function TopHeader() {
  return (
    <header className="top-header">
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
        <div className="avatar-chip" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          <User size={17} />
        </div>
      </div>
    </header>
  );
}
