import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type AuthProviders } from "../api/client.js";
import { useAuth } from "../contexts/AuthContext.js";
import { errorMessage } from "../utils/errorMessage.js";
import { isCancellation, passkeysSupported, registerPasskey, signInWithPasskey } from "../utils/passkeys.js";

const ERROR_MESSAGES: Record<string, string> = {
  passkey_only: "This account uses a passkey. Sign in with your passkey instead.",
  google_not_configured: "Google sign-in isn't set up on this server yet.",
  facebook_not_configured: "Facebook sign-in isn't set up on this server yet.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  facebook_failed: "Facebook sign-in didn't complete. Please try again.",
};

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
  // Null unless a passkey ceremony is in flight — the authenticator prompt can
  // sit there for a while, and two overlapping ceremonies would each clobber
  // the other's challenge in the session.
  const [busy, setBusy] = useState<"signin" | "signup" | null>(null);
  const [serverSupportsPasskeys, setServerSupportsPasskeys] = useState(false);
  // True once a passkey exists on this server, at which point it is the only
  // way in and the other methods retire themselves. See passkeySignInPossible().
  const [passkeyOnly, setPasskeyOnly] = useState(false);

  useEffect(() => {
    api.getAuthProviders().then(setProviders);
    // Both halves have to be able to do it: the browser needs WebAuthn, and
    // the server needs a relying party it can name.
    api
      .passkeysAvailable()
      .then((r) => {
        setServerSupportsPasskeys(r.available);
        setPasskeyOnly(r.exclusive);
      })
      .catch(() => {
        setServerSupportsPasskeys(false);
        setPasskeyOnly(false);
      });
  }, []);

  const passkeyReady = serverSupportsPasskeys && passkeysSupported();

  async function afterSignIn() {
    await refresh();
    navigate("/", { replace: true });
  }

  async function handlePasskeySignIn() {
    setFormError(null);
    setBusy("signin");
    try {
      await signInWithPasskey();
      await afterSignIn();
    } catch (err) {
      // A cancelled prompt throws too, and telling someone their sign-in
      // failed when they chose to dismiss it is just noise.
      if (!isCancellation(err)) setFormError(errorMessage(err, "That passkey didn't work."));
    } finally {
      setBusy(null);
    }
  }

  async function handlePasskeySignUp() {
    setFormError(null);
    setBusy("signup");
    try {
      await registerPasskey("Passkey", email.trim());
      await afterSignIn();
    } catch (err) {
      if (!isCancellation(err)) setFormError(errorMessage(err, "Couldn't create that passkey."));
    } finally {
      setBusy(null);
    }
  }

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
      setFormError(errorMessage(err, mode === "signup" ? "Couldn't create your account." : "Couldn't sign you in."));
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

        {/* Passkey-only, on a browser that can't do WebAuthn, would otherwise
            render a card with nothing in it and no explanation. */}
        {passkeyOnly && !passkeysSupported() && (
          <div className="budget-alert" style={{ textAlign: "left" }}>
            This account signs in with a passkey, and this browser doesn&apos;t support them. Open it in a current
            version of Chrome, Edge, Safari or Firefox.
          </div>
        )}

        {/* Above the OAuth buttons on purpose: a passkey is the quickest way
            in for someone who has one, and the one that works on this server
            without any provider being configured. */}
        {passkeyReady && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "0.6rem" }}>
            <button
              type="button"
              className="btn-accent"
              onClick={handlePasskeySignIn}
              disabled={busy !== null}
              style={{ justifyContent: "center", padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              {busy === "signin" ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              Sign in with a passkey
            </button>
            {/* Not offered once a passkey exists: the account is already
                made, the email field it needs lives in the form below that
                has retired itself, and ALLOWED_SIGNUP_EMAIL may well have
                closed sign-ups anyway. */}
            {mode === "signup" && !passkeyOnly && (
              <button
                type="button"
                onClick={handlePasskeySignUp}
                disabled={busy !== null || !email.trim()}
                style={{ justifyContent: "center", padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
                title={email.trim() ? undefined : "Enter your email address first"}
              >
                {busy === "signup" ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
                Create an account with a passkey
              </button>
            )}
          </div>
        )}

        {/* Everything below retires itself once a passkey exists — see
            passkeySignInPossible(). The server refuses these routes then too;
            hiding a login form that still answers would be theatre. */}
        {!passkeyOnly && (
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
        )}

        {!passkeyOnly && noneConfigured && (
          <p className="empty-state" style={{ marginTop: "1.5rem" }}>
            No OAuth providers are configured yet. Add Google or Facebook credentials to your server's <code>.env</code> to
            enable them.
          </p>
        )}

        {!passkeyOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "1.25rem 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span className="page-header__subtitle" style={{ margin: 0 }}>
            or
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        )}

        {!passkeyOnly && (
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
        )}

        {!passkeyOnly && mode === "signin" && (
          <p className="page-header__subtitle" style={{ marginTop: "0.7rem" }}>
            <Link to="/forgot-password" style={{ color: "var(--accent)" }}>
              Forgot password?
            </Link>
          </p>
        )}

        {!passkeyOnly && (
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
        )}
      </div>
    </div>
  );
}
