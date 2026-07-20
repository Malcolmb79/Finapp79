import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

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

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't reset your password."));
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
        <h1 style={{ marginBottom: "0.3rem" }}>Set a new password</h1>

        {!token ? (
          <p className="budget-alert" style={{ textAlign: "left", marginTop: "1rem" }}>
            This reset link is missing its token. Request a new one from the{" "}
            <Link to="/forgot-password" style={{ color: "var(--accent)" }}>
              forgot password
            </Link>{" "}
            page.
          </p>
        ) : done ? (
          <>
            <p className="empty-state" style={{ marginTop: "1rem" }}>
              Your password has been reset.
            </p>
            <button
              type="button"
              className="btn-accent"
              style={{ justifyContent: "center", padding: "0.6rem", marginTop: "1rem", width: "100%" }}
              onClick={() => navigate("/login", { replace: true })}
            >
              Sign in
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", textAlign: "left", marginTop: "1rem" }}>
            {error && (
              <div className="budget-alert" style={{ textAlign: "left" }}>
                {error}
              </div>
            )}
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <button
              type="submit"
              className="btn-accent"
              style={{ justifyContent: "center", padding: "0.6rem" }}
              disabled={submitting || newPassword.length < 8}
            >
              {submitting ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}

        <p className="page-header__subtitle" style={{ marginTop: "1rem" }}>
          <Link to="/login" style={{ color: "var(--accent)" }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
