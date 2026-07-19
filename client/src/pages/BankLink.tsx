import { useState } from "react";
import { api, type Aspsp } from "../api/client.js";

export default function BankLink() {
  const [country, setCountry] = useState("SE");
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
      <div className="page-header">
        <div>
          <h1>Link a bank</h1>
          <p className="page-header__subtitle">Powered by Enable Banking (open banking, pan-EU/UK).</p>
        </div>
      </div>

      <div className="card">
        <p className="empty-state" style={{ marginTop: 0 }}>
          Testing with a sandbox account? Search "SE" (or "FI"/"DE") and pick <strong>Mock ASPSP</strong> — Enable
          Banking's fake bank for testing, no real credentials needed. (Availability varies by country/account —
          Mock ASPSP doesn't show up under every country code.)
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} style={{ width: 70 }} />
          <button className="btn-accent" onClick={handleSearch}>
            Search institutions
          </button>
        </div>
        {institutions.length === 0 ? (
          <p className="empty-state">No results yet — search a country above.</p>
        ) : (
          <div>
            {institutions.map((inst) => (
              <div className="account-row" key={`${inst.name}-${inst.country}`}>
                <div className="account-row__info">
                  <div className="account-row__name">{inst.name}</div>
                </div>
                <button onClick={() => handleLink(inst)}>Link</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
