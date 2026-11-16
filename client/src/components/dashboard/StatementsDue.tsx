import { FileUp } from "lucide-react";
import { Link } from "react-router-dom";
import type { Account } from "../../api/client.js";
import AccountAvatar from "../AccountAvatar.js";
import { behindPhrase, statementsDue, statementsMissing } from "../../utils/statementsDue.js";

/**
 * The accounts whose statements aren't arriving — in the two ways that can
 * be true, kept apart.
 *
 * One has fallen behind and needs its next statement. The other has never
 * been given anything at all and needs its first. Running them together
 * would make the second read as a lapse, when it is an account nobody
 * finished setting up, and the thing to do about each is different.
 *
 * The alert in the bell carries only the first. Being behind is news — it
 * became true on a particular day and stops being true when you act. An
 * account that has always been empty is not news on any day, and an alert
 * that fires every day until you deal with it is an alert you learn to
 * ignore. So that half lives here, where a standing list belongs.
 */
export default function StatementsDue({ accounts, today }: { accounts: Account[]; today: string }) {
  const due = statementsDue(accounts, today);
  const missing = statementsMissing(accounts, today);

  if (due.length === 0 && missing.length === 0) {
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

  const row = (account: Account, detail: string, tag: string) => (
    <Link key={account.id} to="/accounts" className="statements-due__row">
      <AccountAvatar name={account.name} logo={account.logo} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="statements-due__name">{account.name}</div>
        <div className="statements-due__detail">{detail}</div>
      </div>
      <span className="statements-due__tag">{tag}</span>
      <FileUp size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
    </Link>
  );

  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      {missing.length > 0 && (
        <div>
          <p className="statements-due__lede">
            {missing.length === 1 ? "One account has" : `${missing.length} accounts have`} nothing in{" "}
            {missing.length === 1 ? "it" : "them"} at all — no statement, no entries. The balance{" "}
            {missing.length === 1 ? "it shows is a figure with no history" : "each one shows is a figure with no history"}{" "}
            behind it.
          </p>
          <div style={{ display: "grid", gap: "0.45rem" }}>
            {missing.map((account) => row(account, "Never imported to", "First statement"))}
          </div>
        </div>
      )}

      {due.length > 0 && (
        <div>
          <p className="statements-due__lede">
            {due.length === 1 ? "One account has" : `${due.length} accounts have`} had no statement in over a month.
            Nothing is wrong with {due.length === 1 ? "it" : "them"} — the figures are simply as old as the last import.
          </p>
          <div style={{ display: "grid", gap: "0.45rem" }}>
            {/* The date, not only the gap: "covers to 19 August" is what you
                check a statement against, where "3 months behind" is only how
                it feels. */}
            {due.map(({ account, coversTo, daysBehind }) => row(account, `Covers to ${coversTo}`, behindPhrase(daysBehind)))}
          </div>
        </div>
      )}
    </div>
  );
}
