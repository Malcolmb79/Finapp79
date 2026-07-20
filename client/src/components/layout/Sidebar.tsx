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
import { api, type Account, type Transaction } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { accountBalance } from "../../utils/accountBalance.js";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/transactions", label: "Transactions", icon: Wallet },
  { to: "/budgets", label: "Budgets", icon: Target },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/debt-planner", label: "Debt Planner", icon: PiggyBank },
  { to: "/savings", label: "Savings", icon: PiggyBank },
];

export default function Sidebar({ navOpen, onCloseNav }: { navOpen: boolean; onCloseNav: () => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { user, logout } = useAuth();

  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
  }, []);

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }
  // Linked accounts contribute their real bank balance rather than a sum
  // of the 90-day synced transaction window — see accountBalance.ts.
  const netWorth = accounts.reduce((sum, a) => sum + accountBalance(a, byAccount.get(a.id) ?? 0), 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthDelta = transactions
    .filter((tx) => tx.booking_date.startsWith(thisMonth))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <>
      {navOpen && <div className="sidebar-backdrop" onClick={onCloseNav} />}
      <aside className={`sidebar${navOpen ? " sidebar--open" : ""}`}>
        <div className="sidebar__brand">
          <img src="/logo.png" alt="" style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0 }} />
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
    </>
  );
}
