import { Check, Globe, KeyRound, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AuthIdentities } from "../api/client.js";
import { useAuth } from "../contexts/AuthContext.js";
import { usePalette } from "../contexts/PaletteContext.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { PALETTES } from "../palettes.js";
import { initials } from "../utils/avatarColor.js";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", facebook: "Facebook" };

export default function Settings() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const [identities, setIdentities] = useState<AuthIdentities | null>(null);

  useEffect(() => {
    api.getIdentities().then(setIdentities);
  }, []);

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
          <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.name ?? "Account"} className="avatar-chip" style={{ width: 48, height: 48 }} referrerPolicy="no-referrer" />
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

          <div style={{ fontWeight: 500, fontSize: "0.9rem", marginBottom: "0.2rem" }}>Accent color</div>
          <p className="page-header__subtitle" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
            Pick a palette — it drives the accent color and every chart/progress hue across the app.
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
                      width: 26,
                      height: 26,
                      borderRadius: "999px",
                      background: `hsl(${p.hue} ${p.sat} 45%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {selected && <Check size={14} color="#fff" strokeWidth={3} />}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
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
        </div>
      </div>
    </div>
  );
}
