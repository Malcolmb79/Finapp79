import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AuthProviders } from "../api/client.js";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up on this server yet.",
  facebook_not_configured: "Facebook sign-in isn't set up on this server yet.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  facebook_failed: "Facebook sign-in didn't complete. Please try again.",
};

export default function Login() {
  const [providers, setProviders] = useState<AuthProviders>({ google: false, facebook: false });
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    api.getAuthProviders().then(setProviders);
  }, []);

  const noneConfigured = !providers.google && !providers.facebook;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--page-plane)",
      }}
    >
      <div className="card" style={{ width: 340, textAlign: "center" }}>
        <div className="sidebar__brand-icon" style={{ margin: "0 auto 1rem" }}>
          💰
        </div>
        <h1 style={{ marginBottom: "0.3rem" }}>Personal Finance</h1>
        <p className="page-header__subtitle" style={{ marginBottom: "1.5rem" }}>
          Sign in to continue
        </p>

        {error && (
          <div className="budget-alert" style={{ textAlign: "left" }}>
            {ERROR_MESSAGES[error] ?? "Something went wrong signing in."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <a
            href="/api/auth/google"
            className="btn-accent"
            style={{
              textDecoration: "none",
              justifyContent: "center",
              padding: "0.6rem",
              pointerEvents: providers.google ? "auto" : "none",
              opacity: providers.google ? 1 : 0.5,
            }}
          >
            Continue with Google
          </a>
          <a
            href="/api/auth/facebook"
            className="btn-accent"
            style={{
              textDecoration: "none",
              justifyContent: "center",
              padding: "0.6rem",
              pointerEvents: providers.facebook ? "auto" : "none",
              opacity: providers.facebook ? 1 : 0.5,
            }}
          >
            Continue with Facebook
          </a>
        </div>

        {noneConfigured && (
          <p className="empty-state" style={{ marginTop: "1.5rem" }}>
            No sign-in providers are configured yet. Add Google or Facebook OAuth credentials to your server's{" "}
            <code>.env</code> to enable them.
          </p>
        )}
      </div>
    </div>
  );
}
