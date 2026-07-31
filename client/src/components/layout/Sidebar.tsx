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
import { accountBalance, accountTxSums, visibleAccounts, visibleTransactions } from "../../utils/accountBalance.js";
import { formatCurrency } from "../../utils/formatCurrency.js";
import { sumInBase, useFxRates } from "../../utils/fx.js";
import { useAccountScope } from "../../contexts/ViewFilterContext.js";

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
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const { user, logout } = useAuth();

  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
  }, []);

  const { scope } = useAccountScope();
  const rates = useFxRates("EUR");
  // Hidden accounts are out of the total, and so are their transactions —
  // otherwise net worth excludes an account while the month's change still
  // counts its spending.
  const accounts = visibleAccounts(allAccounts, scope);
  const transactions = visibleTransactions(allTransactions, allAccounts, scope);

  // Counted from the point each balance was set, so a hand-set figure
  // is an opening balance that transactions move rather than a frozen
  // number — see accountTxSums.
  const byAccount = accountTxSums(accounts, transactions);
  // Linked accounts contribute their real bank balance rather than a sum
  // of the 90-day synced transaction window — see accountBalance.ts.
  // Converted rather than added raw — accounts in different currencies are
  // not the same unit, and the sidebar figure has to agree with the
  // dashboard's.
  const { converted: netWorth } = sumInBase(
    accounts.map((a) => ({ amount: accountBalance(a, byAccount.get(a.id) ?? 0), currency: a.currency })),
    rates
  );
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
          <p className="sidebar__net-worth-value">
            {rates ? formatCurrency(netWorth, rates.base) : netWorth.toFixed(2)}
          </p>
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
