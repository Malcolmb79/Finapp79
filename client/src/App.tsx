import { Settings } from "lucide-react";
import { Outlet, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.js";
import Sidebar from "./components/layout/Sidebar.js";
import TopHeader from "./components/layout/TopHeader.js";
import Accounts from "./pages/Accounts.js";
import Analytics from "./pages/Analytics.js";
import BankLink from "./pages/BankLink.js";
import BankLinkCallback from "./pages/BankLinkCallback.js";
import Budgets from "./pages/Budgets.js";
import ComingSoon from "./pages/ComingSoon.js";
import Dashboard from "./pages/Dashboard.js";
import DebtPlanner from "./pages/DebtPlanner.js";
import Login from "./pages/Login.js";
import Savings from "./pages/Savings.js";
import Transactions from "./pages/Transactions.js";

function AppShell() {
  return (
    <RequireAuth>
      <div className="app-shell">
        <Sidebar />
        <div className="main">
          <TopHeader />
          <div className="page-content">
            <Outlet />
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/bank-link" element={<BankLink />} />
        <Route path="/bank-link/callback" element={<BankLinkCallback />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/debt-planner" element={<DebtPlanner />} />
        <Route path="/savings" element={<Savings />} />
        <Route
          path="/settings"
          element={<ComingSoon title="Settings" icon={Settings} description="Account, notification, and app preferences." />}
        />
      </Route>
    </Routes>
  );
}
