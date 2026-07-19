import { Check, Globe, KeyRound, Moon, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, type AuthIdentities } from "../api/client.js";
import { useAuth } from "../contexts/AuthContext.js";
import { usePalette } from "../contexts/PaletteContext.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { paletteHues, PALETTES } from "../palettes.js";
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

          <div style={{ fontWeight: 500, fontSize: "0.9rem", marginBottom: "0.2rem" }}>Color palette</div>
          <p className="page-header__subtitle" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
            Each palette is four complementary colors — the first drives the accent and every chart/progress hue, all four
            show up as widget accents across the dashboard.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
              gap: "0.6rem",
            }}
          >
            {PALETTES.map((p) => {
              const selected = p.name === palette;
              const hues = paletteHues(p.hue);
              return (
                <button
                  key={p.name}
                  onClick={() => setPalette(p.name)}
                  aria-pressed={selected}
                  title={p.name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.55rem 0.3rem",
                    background: selected ? "var(--surface-2)" : "transparent",
                    border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "999px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gridTemplateRows: "1fr 1fr",
                      overflow: "hidden",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  >
                    {hues.map((h, i) => (
                      <span key={i} style={{ background: `hsl(${h} ${p.sat} 45%)` }} />
                    ))}
                    {selected && (
                      <Check
                        size={14}
                        color="#fff"
                        strokeWidth={3}
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))",
                        }}
                      />
                    )}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{p.name}</span>
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
