import { Landmark, Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type Aspsp } from "../api/client.js";

// Curated list of countries Enable Banking's pan-EU/UK open banking coverage
// generally includes — there's no "list supported countries" endpoint to
// query this from, so this is a starting point for search, not a live
// per-account entitlement check (a given app registration can still come
// back empty for a country, the way GB did during initial setup here).
const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "LU", name: "Luxembourg", flag: "🇱🇺" },
];

export default function BankLink() {
  const [country, setCountry] = useState<{ code: string; name: string; flag: string } | null>(null);
  const [institutions, setInstitutions] = useState<Aspsp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkingName, setLinkingName] = useState<string | null>(null);

  async function handlePickCountry(c: { code: string; name: string; flag: string }) {
    setCountry(c);
    setLoading(true);
    setInstitutions(null);
    try {
      setInstitutions(await api.listInstitutions(c.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(aspsp: Aspsp) {
    setLinkingName(aspsp.name);
    try {
      const { authorizationUrl } = await api.startBankLink(aspsp.name, aspsp.country, aspsp.logo);
      window.location.href = authorizationUrl;
    } finally {
      setLinkingName(null);
    }
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
        {!country ? (
          <>
            <p style={{ fontWeight: 500, marginBottom: "0.3rem" }}>Choose a country</p>
            <p className="page-header__subtitle" style={{ marginTop: 0, marginBottom: "1rem" }}>
              Testing? Pick Sweden, Finland, or Germany and look for <strong>Mock ASPSP</strong> — Enable Banking's
              sandbox bank, no real credentials needed.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.6rem" }}>
              {COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => handlePickCountry(c)}
                  style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 0.8rem", justifyContent: "flex-start" }}
                >
                  <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{c.flag}</span>
                  <span style={{ fontSize: "0.88rem" }}>{c.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <p style={{ fontWeight: 500, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{country.flag}</span>
                Banks in {country.name}
              </p>
              <button
                onClick={() => {
                  setCountry(null);
                  setInstitutions(null);
                }}
              >
                ← Choose a different country
              </button>
            </div>

            {loading ? (
              <p className="empty-state" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Loader2 size={14} className="spin" /> Loading banks…
              </p>
            ) : institutions && institutions.length === 0 ? (
              <p className="empty-state">No banks available for {country.name} yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0.7rem" }}>
                {institutions?.map((inst) => {
                  const isLinking = linkingName === inst.name;
                  return (
                    <button
                      key={`${inst.name}-${inst.country}`}
                      onClick={() => handleLink(inst)}
                      disabled={linkingName !== null}
                      style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 0.8rem", justifyContent: "flex-start" }}
                    >
                      {inst.logo ? (
                        <img
                          src={inst.logo}
                          alt=""
                          style={{ width: 30, height: 30, borderRadius: 7, objectFit: "contain", flexShrink: 0, background: "#fff" }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 7,
                            background: "var(--surface-2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Landmark size={15} />
                        </span>
                      )}
                      <span style={{ fontSize: "0.88rem", textAlign: "left", flex: 1, minWidth: 0 }}>{inst.name}</span>
                      {isLinking && <Loader2 size={14} className="spin" />}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
