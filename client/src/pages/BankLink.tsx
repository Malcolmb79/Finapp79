import { useState } from "react";
import { api, type Aspsp } from "../api/client.js";

export default function BankLink() {
  const [country, setCountry] = useState("GB");
  const [institutions, setInstitutions] = useState<Aspsp[]>([]);

  async function handleSearch() {
    setInstitutions(await api.listInstitutions(country));
  }

  async function handleLink(aspsp: Aspsp) {
    const { authorizationUrl } = await api.startBankLink(aspsp.name, aspsp.country);
    window.location.href = authorizationUrl;
  }

  return (
    <div>
      <h1>Link a bank</h1>
      <p>Powered by Enable Banking (open banking, pan-EU/UK).</p>
      <p>
        Testing with a sandbox account? Search "GB" and pick <strong>Mock ASPSP</strong> — Enable Banking's
        fake bank for testing, no real credentials needed.
      </p>
      <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
      <button onClick={handleSearch}>Search institutions</button>
      <ul>
        {institutions.map((inst) => (
          <li key={`${inst.name}-${inst.country}`}>
            {inst.name} <button onClick={() => handleLink(inst)}>Link</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
