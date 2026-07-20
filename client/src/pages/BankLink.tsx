import { Landmark, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { api } from "../api/client.js";

// The link_token has to survive a full-page redirect out to the bank and
// back for OAuth institutions (basically all UK/EU banks) — sessionStorage
// is what BankLinkCallback.tsx reads to resume the same Link session.
const LINK_TOKEN_KEY = "plaid_link_token";

export default function BankLink() {
  const navigate = useNavigate();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .createLinkToken()
      .then(({ linkToken }) => {
        setLinkToken(linkToken);
        sessionStorage.setItem(LINK_TOKEN_KEY, linkToken);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const onSuccess: PlaidLinkOnSuccess = async (publicToken, metadata) => {
    if (!metadata.institution) {
      setError("Couldn't determine which bank was selected — try again.");
      return;
    }
    setLinking(true);
    setError(null);
    try {
      const { linkedAccounts } = await api.exchangePublicToken(publicToken, metadata.institution.institution_id);
      for (const accountId of linkedAccounts) {
        await api.syncAccount(accountId);
      }
      sessionStorage.removeItem(LINK_TOKEN_KEY);
      navigate("/accounts");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Link a bank</h1>
          <p className="page-header__subtitle">Powered by Plaid.</p>
        </div>
      </div>

      <div className="card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
        <div
          className="avatar-chip"
          style={{ width: 56, height: 56, margin: "0 auto 1rem", background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          <Landmark size={26} />
        </div>
        <p style={{ fontWeight: 500, marginBottom: "0.3rem" }}>Connect your bank account</p>
        <p className="page-header__subtitle" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          You'll search for your bank and sign in securely through Plaid — we never see your bank credentials.
        </p>

        {error && (
          <div className="budget-alert" style={{ textAlign: "left", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        <button
          className="btn-accent"
          onClick={() => open()}
          disabled={!ready || linking}
          style={{ padding: "0.6rem 1.4rem", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
        >
          {linking && <Loader2 size={15} className="spin" />}
          {linking ? "Finishing up…" : "Connect a bank"}
        </button>
      </div>
    </div>
  );
}
