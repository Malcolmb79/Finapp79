import { NavLink, Route, Routes } from "react-router-dom";
import BankLink from "./pages/BankLink.js";
import Dashboard from "./pages/Dashboard.js";
import Transactions from "./pages/Transactions.js";

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: "1.5rem" }}>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <NavLink to="/bank-link">Link a bank</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/bank-link" element={<BankLink />} />
      </Routes>
    </div>
  );
}
