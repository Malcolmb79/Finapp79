import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type AuthProviders } from "../api/client.js";
import { useAuth } from "../contexts/AuthContext.js";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up on this server yet.",
  facebook_not_configured: "Facebook sign-in isn't set up on this server yet.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  facebook_failed: "Facebook sign-in didn't complete. Please try again.",
};

// api/client.ts throws `Error("<status>: <bodyText>")`; the routes here
// always send a JSON `{ error }` body, so pull that out for display instead
// of showing the raw "409: {\"error\":...}" string.
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const body = err.message.slice(err.message.indexOf(": ") + 2);
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Not JSON — fall through to the generic message.
    }
  }
  return fallback;
}

export default function Login() {
  const [providers, setProviders] = useState<AuthProviders>({ google: false, facebook: false });
  const [searchParams] = useSearchParams();
  const oauthError = searchParams.get("error");
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getAuthProviders().then(setProviders);
  }, []);

  const noneConfigured = !providers.google && !providers.facebook;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await api.signup(email, password, name);
      } else {
        await api.login(email, password);
      }
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, mode === "signup" ? "Couldn't create your account." : "Couldn't sign you in."));
    } finally {
      setSubmitting(false);
    }
  }

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
      <div className="card" style={{ width: 360, textAlign: "center" }}>
        <img src="/logo.png" alt="" style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 1rem", display: "block" }} />
        <h1 style={{ marginBottom: "0.3rem" }}>Personal Finance</h1>
        <p className="page-header__subtitle" style={{ marginBottom: "1.5rem" }}>
          {mode === "signup" ? "Create an account to continue" : "Sign in to continue"}
        </p>

        {oauthError && (
          <div className="budget-alert" style={{ textAlign: "left" }}>
            {ERROR_MESSAGES[oauthError] ?? "Something went wrong signing in."}
          </div>
        )}
        {formError && (
          <div className="budget-alert" style={{ textAlign: "left" }}>
            {formError}
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
            No OAuth providers are configured yet. Add Google or Facebook credentials to your server's <code>.env</code> to
            enable them.
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "1.25rem 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span className="page-header__subtitle" style={{ margin: 0 }}>
            or
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", textAlign: "left" }}>
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
          <button type="submit" className="btn-accent" style={{ justifyContent: "center", padding: "0.6rem" }} disabled={submitting}>
            {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        {mode === "signin" && (
          <p className="page-header__subtitle" style={{ marginTop: "0.7rem" }}>
            <Link to="/forgot-password" style={{ color: "var(--accent)" }}>
              Forgot password?
            </Link>
          </p>
        )}

        <p className="page-header__subtitle" style={{ marginTop: "1rem" }}>
          {mode === "signup" ? "Already have an account?" : "Need an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setFormError(null);
            }}
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" }}
          >
            {mode === "signup" ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
