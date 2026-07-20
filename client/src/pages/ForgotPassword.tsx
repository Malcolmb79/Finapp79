import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.forgotPassword(email);
    } finally {
      // Always show the same confirmation regardless of outcome — the API
      // itself is enumeration-safe (204 whether or not the email exists),
      // so the UI shouldn't leak that distinction either.
      setSubmitting(false);
      setSent(true);
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
        <div className="sidebar__brand-icon" style={{ margin: "0 auto 1rem" }}>
          💰
        </div>
        <h1 style={{ marginBottom: "0.3rem" }}>Reset your password</h1>
        <p className="page-header__subtitle" style={{ marginBottom: "1.5rem" }}>
          {sent ? "Check your inbox for a reset link." : "Enter your email and we'll send you a reset link."}
        </p>

        {sent ? (
          <p className="empty-state">
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", textAlign: "left" }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button type="submit" className="btn-accent" style={{ justifyContent: "center", padding: "0.6rem" }} disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
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
