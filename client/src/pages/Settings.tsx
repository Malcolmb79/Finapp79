import { Check, Globe, KeyRound, Moon, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, type AuthIdentities } from "../api/client.js";
import { useAuth } from "../contexts/AuthContext.js";
import { usePalette } from "../contexts/PaletteContext.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { THEMES } from "../palettes.js";
import { initials } from "../utils/avatarColor.js";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", facebook: "Facebook" };

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

export default function Settings() {
  const { user, refresh } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const [identities, setIdentities] = useState<AuthIdentities | null>(null);

  const [name, setName] = useState(user?.name ?? "");
  const [lastUserName, setLastUserName] = useState(user?.name ?? "");
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  // Sync the input when the underlying user record changes (e.g. AuthContext
  // refresh() after another tab's edit) — adjusting state during render
  // rather than in an effect, per React's documented pattern, to avoid an
  // extra render on every mount.
  if ((user?.name ?? "") !== lastUserName) {
    setLastUserName(user?.name ?? "");
    setName(user?.name ?? "");
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [sendingVerification, setSendingVerification] = useState(false);

  async function handleResendVerification() {
    setSendingVerification(true);
    setResendStatus(null);
    try {
      await api.resendVerification();
      setResendStatus("Verification email sent — check your inbox.");
    } catch (err) {
      setResendStatus(extractErrorMessage(err, "Couldn't send the verification email."));
    } finally {
      setSendingVerification(false);
    }
  }

  useEffect(() => {
    api.getIdentities().then(setIdentities);
  }, []);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setNameStatus(null);
    setSavingName(true);
    try {
      await api.updateProfile(name);
      await refresh();
      setNameStatus("Saved.");
    } catch (err) {
      setNameStatus(extractErrorMessage(err, "Couldn't save your name."));
    } finally {
      setSavingName(false);
    }
  }

  async function handleSavePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordStatus(null);
    setSavingPassword(true);
    try {
      await api.setPassword(newPassword, identities?.hasPassword ? currentPassword : undefined);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordStatus({ kind: "ok", text: identities?.hasPassword ? "Password changed." : "Password set." });
      setIdentities((prev) => (prev ? { ...prev, hasPassword: true } : prev));
    } catch (err) {
      setPasswordStatus({ kind: "error", text: extractErrorMessage(err, "Couldn't update your password.") });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-header__subtitle">Account, appearance, and sign-in preferences.</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 640 }}>
        <div className="card">
          <div className="card__header">
            <span className="card__title">Profile</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: "1.1rem" }}>
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name ?? "Account"}
                className="avatar-chip"
                style={{ width: 48, height: 48 }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="avatar-chip"
                style={{ width: 48, height: 48, fontSize: "1.1rem", background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                {user?.name ? initials(user.name) : "?"}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 600 }}>{user?.name ?? "Unnamed"}</div>
              <div className="page-header__subtitle" style={{ marginTop: "0.1rem" }}>
                {user?.email ?? "No email on file"}
              </div>
            </div>
          </div>

          {user?.email && !user.email_verified_at && (
            <div className="budget-alert" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <span>Your email address isn't verified yet.</span>
              <button
                type="button"
                onClick={handleResendVerification}
                className="btn-accent"
                style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
                disabled={sendingVerification}
              >
                {sendingVerification ? "Sending…" : "Resend email"}
              </button>
            </div>
          )}
          {resendStatus && (
            <p className="page-header__subtitle" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
              {resendStatus}
            </p>
          )}

          <form onSubmit={handleSaveName} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="settings-name" style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
                Display name
              </label>
              <input id="settings-name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
            </div>
            <button type="submit" className="btn-accent" style={{ marginTop: "1.4rem" }} disabled={savingName || !name.trim()}>
              {savingName ? "Saving…" : "Save"}
            </button>
          </form>
          {nameStatus && (
            <p className="page-header__subtitle" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              {nameStatus}
            </p>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">Appearance</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.1rem" }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>Theme</div>
              <div className="page-header__subtitle" style={{ margin: 0 }}>
                Switch between light and dark mode.
              </div>
            </div>
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle color theme">
              {theme === "light" ? (
                <>
                  <Sun size={14} /> Light
                </>
              ) : (
                <>
                  <Moon size={14} /> Dark
                </>
              )}
            </button>
          </div>

          <div style={{ fontWeight: 500, fontSize: "0.9rem", marginBottom: "0.2rem" }}>Theme</div>
          <p className="page-header__subtitle" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
            Each theme sets backgrounds, surfaces, text, and accent colors together — a full look, not just one color.
            Works with light/dark mode above, whichever is selected.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "0.7rem",
            }}
          >
            {THEMES.map((t) => {
              const selected = t.id === palette;
              return (
                <button
                  key={t.id}
                  onClick={() => setPalette(t.id)}
                  aria-pressed={selected}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "0.5rem",
                    padding: "0.6rem",
                    textAlign: "left",
                    background: selected ? "var(--surface-2)" : "transparent",
                    border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      position: "relative",
                      height: 44,
                      borderRadius: 8,
                      background: t.previewBg,
                      border: "1px solid rgba(0,0,0,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 8,
                        right: 8,
                        bottom: 16,
                        borderRadius: 5,
                        background: t.previewSurface,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                      }}
                    />
                    <span style={{ position: "absolute", left: 8, bottom: 5, display: "flex", gap: "0.25rem" }}>
                      {[t.hue, t.hue2, t.hue3, t.hue4].map((h, i) => (
                        <span
                          key={i}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "999px",
                            background: `hsl(${h} ${t.sat} 45%)`,
                          }}
                        />
                      ))}
                    </span>
                    {selected && (
                      <span
                        style={{
                          position: "absolute",
                          right: 6,
                          top: 6,
                          width: 18,
                          height: 18,
                          borderRadius: "999px",
                          background: `hsl(${t.hue} ${t.sat} 42%)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Check size={11} color="#fff" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>{t.description}</div>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">Sign-in methods</span>
          </div>
          {identities ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.1rem" }}>
              {identities.providers.map((provider) => (
                <div key={provider} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem" }}>
                  <Globe size={16} />
                  {PROVIDER_LABEL[provider] ?? provider} connected
                </div>
              ))}
              {identities.hasPassword && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem" }}>
                  <KeyRound size={16} />
                  Email and password
                </div>
              )}
              {identities.providers.length === 0 && !identities.hasPassword && (
                <p className="empty-state">No sign-in methods found.</p>
              )}
            </div>
          ) : (
            <p className="empty-state">Loading…</p>
          )}

          {identities && (
            <form onSubmit={handleSavePassword} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 320 }}>
              <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{identities.hasPassword ? "Change password" : "Set a password"}</div>
              {!identities.hasPassword && (
                <p className="page-header__subtitle" style={{ margin: 0 }}>
                  Add a password so you can also sign in with email, not just {identities.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" or ")}.
                </p>
              )}
              {identities.hasPassword && (
                <input
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              )}
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
              <button type="submit" className="btn-accent" style={{ justifyContent: "center" }} disabled={savingPassword || newPassword.length < 8}>
                {savingPassword ? "Saving…" : identities.hasPassword ? "Change password" : "Set password"}
              </button>
              {passwordStatus && (
                <p
                  className="page-header__subtitle"
                  style={{ margin: 0, color: passwordStatus.kind === "error" ? "var(--critical)" : undefined }}
                >
                  {passwordStatus.text}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
