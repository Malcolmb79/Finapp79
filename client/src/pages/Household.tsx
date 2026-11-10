import { Eye, Loader2, Mail, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type HouseholdState } from "../api/client.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";

/**
 * Letting someone else see your finances, and looking at theirs.
 *
 * A household shares a picture, so a share is all-or-nothing rather than
 * per-account — answering "what can my partner see" account by account is a
 * permissions system, and a permissions system in a two-person app is a
 * burden nobody asked for.
 *
 * The one distinction kept is read versus write, because the common case is
 * showing rather than handing over: an accountant, a parent helping out, a
 * partner who wants to see but not touch.
 */
export default function Household() {
  const [state, setState] = useState<HouseholdState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(() => {
    api.household().then(setState).catch(() => {});
  }, []);
  useEffect(load, [load]);

  // An invite link lands here with its token. Accepting is the one thing on
  // this page that happens without being asked for.
  const token = params.get("token");
  useEffect(() => {
    if (!token) return;
    api
      .acceptHouseholdInvite(token)
      .then(() => {
        setNotice("Invitation accepted.");
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.delete("token");
          return next;
        });
      });
  }, [token, load, setParams]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.inviteToHousehold(email.trim(), role);
      setNotice(`Invitation sent to ${email.trim()}. Nothing is shared until they accept.`);
      setEmail("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    setBusy(true);
    try {
      await api.endHouseholdShare(id);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function view(userId: string | null) {
    setBusy(true);
    try {
      await api.viewHousehold(userId);
      // A full reload rather than a refetch: every page on screen is built
      // from somebody's figures, and switching whose means all of them are
      // now wrong. Reloading is the honest way to replace the lot at once.
      window.location.assign("/");
    } finally {
      setBusy(false);
    }
  }

  const widgets: WidgetSpec[] = [
    {
      id: "share",
      title: "Share your finances",
      icon: Mail,
      accentVar: "--accent",
      defaultWidth: 328,
      defaultHeight: 300,
      render: () => (
        <div>
          <form onSubmit={invite} style={{ display: "grid", gap: "0.4rem", marginBottom: "0.7rem" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their email address"
              aria-label="Email address to invite"
            />
            <select value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} aria-label="What they may do">
              <option value="viewer">Can look, can’t change</option>
              <option value="editor">Can look and change</option>
            </select>
            <button type="submit" className="btn-accent" disabled={busy || !email.trim()}>
              {busy ? <Loader2 size={14} className="spin" /> : "Send invitation"}
            </button>
          </form>

          {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)" }}>{error}</p>}
          {notice && <p style={{ fontSize: "0.78rem", color: "var(--good)" }}>{notice}</p>}

          {state?.shared.length === 0 ? (
            <p className="empty-state">Nobody else can see your finances.</p>
          ) : (
            state?.shared.map((share) => (
              <div key={share.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", padding: "0.3rem 0" }}>
                <span style={{ flex: 1 }}>
                  {share.invited_email}
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}
                    · {share.role === "editor" ? "can change" : "read only"}
                    {share.status === "pending" && " · not accepted yet"}
                  </span>
                </span>
                <button onClick={() => end(share.id)} disabled={busy} aria-label={`Stop sharing with ${share.invited_email}`} title="Stop sharing">
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      id: "access",
      title: "Finances shared with you",
      icon: Users,
      accentVar: "--accent-2",
      defaultWidth: 328,
      defaultHeight: 300,
      render: () => (
        <div>
          {state?.access.length === 0 ? (
            <p className="empty-state">Nobody has shared their finances with you.</p>
          ) : (
            state?.access.map((entry) => {
              const active = state.viewing === entry.owner_user_id;
              return (
                <div
                  key={entry.owner_user_id}
                  style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", padding: "0.3rem 0" }}
                >
                  <span style={{ flex: 1 }}>
                    {entry.owner_name}
                    <span style={{ color: "var(--text-muted)" }}> · {entry.role === "editor" ? "can change" : "read only"}</span>
                  </span>
                  <button onClick={() => view(active ? null : entry.owner_user_id)} disabled={busy} style={{ fontSize: "0.78rem" }}>
                    {active ? "Back to mine" : "Look at theirs"}
                  </button>
                </div>
              );
            })
          )}
          {state?.viewing && (
            <p style={{ fontSize: "0.75rem", color: "var(--accent)", marginTop: "0.5rem", display: "flex", gap: "0.3rem" }}>
              <Eye size={13} /> You are looking at someone else’s finances.
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Household</h1>
          <p className="page-header__subtitle">
            Share your whole picture with someone, or look at theirs · nothing is shared until they accept
          </p>
        </div>
      </div>
      <WidgetCanvas storageKey="household.layout.v1" widgets={widgets} />
    </div>
  );
}
