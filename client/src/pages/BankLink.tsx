import { useState } from "react";
import { api } from "../api/client.js";

export default function BankLink() {
  const [country, setCountry] = useState("US");
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);

  async function handleSearch() {
    setInstitutions(await api.listInstitutions(country));
  }

  async function handleLink(id: string, name: string) {
    const { authorizationUrl } = await api.startBankLink(id, name);
    window.location.href = authorizationUrl;
  }

  return (
    <div>
      <h1>Link a bank</h1>
      <p>Powered by GoCardless Bank Account Data (open banking).</p>
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
