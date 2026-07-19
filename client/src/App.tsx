import { NavLink, Route, Routes } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle.js";
import BankLink from "./pages/BankLink.js";
import BankLinkCallback from "./pages/BankLinkCallback.js";
import Dashboard from "./pages/Dashboard.js";
import Transactions from "./pages/Transactions.js";

export default function App() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem" }}>
      <nav className="app-nav">
        <div className="app-nav__links">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/bank-link">Link a bank</NavLink>
        </div>
        <ThemeToggle />
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/bank-link" element={<BankLink />} />
        <Route path="/bank-link/callback" element={<BankLinkCallback />} />
      </Routes>
    </div>
  );
}
