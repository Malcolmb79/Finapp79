import { FileUp } from "lucide-react";
import { Link } from "react-router-dom";
import type { Account } from "../../api/client.js";
import AccountAvatar from "../AccountAvatar.js";
import { behindPhrase, statementsDue } from "../../utils/statementsDue.js";

/**
 * The accounts whose statements have stopped arriving.
 *
 * The alert in the bell says the same thing the moment it becomes true, and
 * is the surface that matters for being told. This is the one for keeping
 * on top of it: a standing list that is empty when everything is current,
 * which is a different and quieter kind of useful — a thing you can glance
 * at rather than a thing that interrupts you.
 */
export default function StatementsDue({ accounts, today }: { accounts: Account[]; today: string }) {
  const due = statementsDue(accounts, today);

  if (due.length === 0) {
    // Named rather than left blank. "Nothing here" could equally mean
    // nothing is behind or nothing is being tracked, and those are very
    // different states to be in.
    const tracked = accounts.filter((a) => !a.hidden && a.source === "manual" && a.last_import_at).length;
    return (
      <p className="empty-state">
        {tracked === 0
          ? "No account is kept up to date by importing statements yet."
          : `Up to date — ${tracked} ${tracked === 1 ? "account is" : "accounts are"} current.`}
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.6rem", lineHeight: 1.45 }}>
        {due.length === 1 ? "One account has" : `${due.length} accounts have`} had no statement in over a month. Nothing is
        wrong with {due.length === 1 ? "it" : "them"} — the figures are simply as old as the last import.
      </p>

      <div style={{ display: "grid", gap: "0.45rem" }}>
        {due.map(({ account, coversTo, daysBehind }) => (
          <Link
            key={account.id}
            to="/accounts"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.55rem",
              padding: "0.45rem 0.5rem",
              borderRadius: 8,
              border: "1px solid var(--gridline)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <AccountAvatar name={account.name} logo={account.logo} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.86rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {account.name}
              </div>
              {/* The date, not only the gap: "covers to 19 August" is what
                  you check a statement against, where "89 days" is only how
                  it feels. */}
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Covers to {coversTo}</div>
            </div>
            <span
              style={{
                fontSize: "0.72rem",
                padding: "0.1rem 0.4rem",
                borderRadius: 999,
                whiteSpace: "nowrap",
                background: "color-mix(in srgb, var(--warning) 18%, transparent)",
                color: "var(--warning)",
              }}
            >
              {behindPhrase(daysBehind)}
            </span>
            <FileUp size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
