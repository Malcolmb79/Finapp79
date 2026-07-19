import { useState } from "react";
import { api } from "../api/client.js";

export default function BankLink() {
  const [country, setCountry] = useState("GB");
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);

  async function handleSearch() {
    setInstitutions(await api.listInstitutions(country));
  }

  async function handleLink(id: string, name: string) {
    const { requisitionId, authorizationUrl } = await api.startBankLink(id, name);
    // GoCardless's redirect back to us doesn't reliably include the
    // requisition id, so stash it here for the callback page to pick up.
    localStorage.setItem("gc_pending_requisition_id", requisitionId);
    window.location.href = authorizationUrl;
  }

  return (
    <div>
      <h1>Link a bank</h1>
      <p>Powered by GoCardless Bank Account Data (open banking).</p>
      <p>
        Testing with a sandbox account? Search "GB" and pick <strong>Sandbox Finance</strong> — GoCardless's
        fake bank for testing, no real credentials needed.
      </p>
      <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
      <button onClick={handleSearch}>Search institutions</button>
      <ul>
        {institutions.map((inst) => (
          <li key={inst.id}>
            {inst.name} <button onClick={() => handleLink(inst.id, inst.name)}>Link</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
