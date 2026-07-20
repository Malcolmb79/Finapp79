import { useState } from "react";
import { Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.js";
import Sidebar from "./components/layout/Sidebar.js";
import TopHeader from "./components/layout/TopHeader.js";
import Accounts from "./pages/Accounts.js";
import Analytics from "./pages/Analytics.js";
import BankLink from "./pages/BankLink.js";
import BankLinkCallback from "./pages/BankLinkCallback.js";
import Budgets from "./pages/Budgets.js";
import Dashboard from "./pages/Dashboard.js";
import DebtPlanner from "./pages/DebtPlanner.js";
import ForgotPassword from "./pages/ForgotPassword.js";
import Login from "./pages/Login.js";
import ResetPassword from "./pages/ResetPassword.js";
import Savings from "./pages/Savings.js";
import Settings from "./pages/Settings.js";
import Transactions from "./pages/Transactions.js";

function EmailVerifiedBanner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const emailVerified = searchParams.get("emailVerified");
  if (!emailVerified) return null;

  const ok = emailVerified === "1";
  return (
    <div
      className="budget-alert"
      style={
        ok
          ? { background: "color-mix(in srgb, var(--good) 15%, transparent)", color: "var(--good)", borderColor: "color-mix(in srgb, var(--good) 30%, transparent)" }
          : undefined
      }
    >
      {ok ? "Your email has been verified." : "That verification link is invalid or has expired."}
      <button
        type="button"
        onClick={() => {
          searchParams.delete("emailVerified");
          setSearchParams(searchParams, { replace: true });
        }}
        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: "0.6rem", textDecoration: "underline" }}
      >
        Dismiss
      </button>
    </div>
  );
}

function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const [lastPathname, setLastPathname] = useState(location.pathname);

  // Close the mobile drawer whenever the active module changes, so it never
  // stays open after a nav click eats the screen real estate it exists to
  // save. Adjusting state during render (React's documented pattern for
  // "reset state when a prop changes") instead of an effect, since an effect
  // here would cause an extra render on every navigation.
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    setNavOpen(false);
  }

  return (
    <RequireAuth>
      <div className="app-shell">
        <Sidebar navOpen={navOpen} onCloseNav={() => setNavOpen(false)} />
        <div className="main">
          <TopHeader onOpenNav={() => setNavOpen(true)} />
          <div className="page-content">
            <EmailVerifiedBanner />
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
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
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
