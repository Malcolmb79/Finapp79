import {
  BarChart3,
  Landmark,
  LayoutDashboard,
  LogOut,
  PiggyBank,
  Settings,
  ShieldCheck,
  Target,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, type Transaction } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.js";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/transactions", label: "Transactions", icon: Wallet },
  { to: "/budgets", label: "Budgets", icon: Target },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/debt-planner", label: "Debt Planner", icon: PiggyBank },
  { to: "/savings", label: "Savings", icon: PiggyBank },
];

export default function Sidebar() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const { user, logout } = useAuth();

  useEffect(() => {
    api.listTransactions().then(setTransactions);
  }, []);

  const netWorth = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthDelta = transactions
    .filter((tx) => tx.booking_date.startsWith(thisMonth))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon">
          <Wallet size={18} />
        </div>
        <div>
          <div className="sidebar__brand-name">Personal Finance</div>
          <div className="sidebar__brand-sub">Your money, at a glance</div>
        </div>
      </div>

      <div className="sidebar__user">
        <p className="sidebar__greeting">👋 Welcome back, {firstName}</p>
        <p className="sidebar__net-worth-label">Net worth</p>
        <p className="sidebar__net-worth-value">{netWorth.toFixed(2)}</p>
        <p className="sidebar__net-worth-delta">
          {monthDelta >= 0 ? "↗" : "↘"} {monthDelta.toFixed(2)} this month
        </p>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar__nav-link${isActive ? " active" : ""}`}>
            <span className="sidebar__nav-icon">
              <Icon size={17} />
            </span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__badge">
          <ShieldCheck size={14} />
          Personal use only
        </div>
        <NavLink to="/settings" className="sidebar__footer-link">
          <Settings size={14} style={{ verticalAlign: "-2px", marginRight: "0.4rem" }} />
          Settings
        </NavLink>
        <button
          onClick={logout}
          className="sidebar__footer-link"
          style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
        >
          <LogOut size={14} style={{ verticalAlign: "-2px", marginRight: "0.4rem" }} />
          Log out
        </button>
      </div>
    </aside>
  );
}
