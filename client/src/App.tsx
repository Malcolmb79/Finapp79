import { PiggyBank, Settings } from "lucide-react";
import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar.js";
import TopHeader from "./components/layout/TopHeader.js";
import Accounts from "./pages/Accounts.js";
import Analytics from "./pages/Analytics.js";
import BankLink from "./pages/BankLink.js";
import BankLinkCallback from "./pages/BankLinkCallback.js";
import Budgets from "./pages/Budgets.js";
import ComingSoon from "./pages/ComingSoon.js";
import Dashboard from "./pages/Dashboard.js";
import Transactions from "./pages/Transactions.js";

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <TopHeader />
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/bank-link" element={<BankLink />} />
            <Route path="/bank-link/callback" element={<BankLinkCallback />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route
              path="/debt-planner"
              element={<ComingSoon title="Debt Planner" icon={PiggyBank} description="Track balances and plan payoff schedules." />}
            />
            <Route
              path="/savings"
              element={<ComingSoon title="Savings" icon={PiggyBank} description="Set savings goals and track progress toward them." />}
            />
            <Route
              path="/settings"
              element={<ComingSoon title="Settings" icon={Settings} description="Account, notification, and app preferences." />}
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
