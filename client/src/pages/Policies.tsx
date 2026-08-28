import { AlertTriangle, Loader2, Trash2, Umbrella, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import PolicyImportModal from "../components/PolicyImportModal.js";
import { api, type NetWorthSource, type Policy, type PolicyFacts } from "../api/client.js";
import { useRefresh } from "../contexts/RefreshContext.js";
import { fileToBase64 } from "../utils/fileBytes.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { canCount, countsAtCover, policyContribution } from "../utils/policyValue.js";

/**
 * Life insurance policies.
 *
 * The page exists because a policy is worth something and the app had nowhere
 * to put it — but "worth something" is two different figures on the same
 * statement, and the whole layout below is arranged around keeping them apart:
 *
 *   The cover amount pays out on death. It is shown, because it is the thing
 *   the policy is *for*, and it is never counted as wealth by default.
 *
 *   The surrender value is what the policy is worth if cashed in today. That
 *   one behaves like a balance, and it is what a policy normally contributes.
 *
 * Which figure counts is a choice made per policy, and the card keeps saying
 * which choice was made rather than letting it vanish into a total.
 */

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "a month",
  quarterly: "a quarter",
  annual: "a year",
};

function PolicyCard({ policy, onChanged }: { policy: Policy; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [facts, setFacts] = useState<PolicyFacts | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const included = policy.net_worth_source !== "none";
  const contribution = policyContribution(policy);

  async function readStatement(file: File) {
    setReading(true);
    setNotice(null);
    try {
      setFacts(await api.previewPolicyDocument(await fileToBase64(file)));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not read that document.");
    } finally {
      setReading(false);
    }
  }

  async function setSource(source: NetWorthSource) {
    setBusy(true);
    try {
      await api.updatePolicy(policy.id, { net_worth_source: source });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deletePolicy(policy.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="budget-row">
      <div className="budget-row__meta">
        <span style={{ fontWeight: 600 }}>
          {policy.name}
          {policy.insurer ? <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> · {policy.insurer}</span> : null}
        </span>
        {policy.policy_number && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{policy.policy_number}</span>}
      </div>

      {/* The two figures side by side and labelled for what they are. Shown
          together on purpose: seeing "pays out on death" next to "worth if
          cashed in today" is what makes the choice below an informed one. */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
        <div>
          <p className="stat-tile__label">Cover</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>
            {policy.cover_amount != null ? formatCurrency(policy.cover_amount, policy.currency) : "—"}
          </p>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>paid out on death</p>
        </div>
        <div>
          <p className="stat-tile__label">Surrender value</p>
          <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>
            {policy.surrender_value != null ? formatCurrency(policy.surrender_value, policy.currency) : "—"}
          </p>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
            {policy.surrender_value != null ? "worth if cashed in today" : "none — a pure risk policy"}
          </p>
        </div>
        {policy.premium != null && (
          <div>
            <p className="stat-tile__label">Premium</p>
            <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>
              {formatCurrency(policy.premium, policy.currency)}
            </p>
            <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
              {FREQUENCY_LABEL[policy.premium_frequency ?? "monthly"]}
            </p>
          </div>
        )}
        {policy.maturity_date && (
          <div>
            <p className="stat-tile__label">Matures</p>
            <p className="stat-tile__value" style={{ fontSize: "1.05rem" }}>
              {policy.maturity_date}
            </p>
          </div>
        )}
      </div>

      {policy.valued_at && (
        <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
          Figures as at {policy.valued_at}
          {policy.valuations.length > 1 && ` · ${policy.valuations.length} statements recorded`}
        </p>
      )}

      {/* The inclusion control. Off by default, and the figure has to be named
          rather than assumed: there is no safe guess between a cash value and a
          sum assured, and a net worth that is wrong reads exactly like one that
          is right. */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem" }}>
          <input
            type="checkbox"
            checked={included}
            disabled={busy || !canCount(policy)}
            onChange={(e) => setSource(e.target.checked ? (policy.surrender_value != null ? "surrender" : "cover") : "none")}
          />
          Count towards net worth
        </label>

        {included && (
          <select
            value={policy.net_worth_source}
            disabled={busy}
            onChange={(e) => setSource(e.target.value as NetWorthSource)}
            style={{ fontSize: "0.8rem", padding: "0.2rem 0.3rem" }}
            aria-label="Which figure counts"
          >
            <option value="surrender" disabled={policy.surrender_value == null}>
              at its surrender value
            </option>
            <option value="cover" disabled={policy.cover_amount == null}>
              at its cover amount
            </option>
          </select>
        )}

        {included && (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            adds {formatCurrency(contribution, policy.currency)}
          </span>
        )}
      </div>

      {!canCount(policy) && (
        <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
          No figures recorded yet — upload a statement and it can be counted.
        </p>
      )}

      {/* Travels with the policy wherever the choice does. Not a warning that
          something is broken: counting a policy at its cover amount is allowed
          and honoured. It just should never become invisible, because the
          figure answers a different question from the rest of net worth. */}
      {countsAtCover(policy) && (
        <p
          style={{
            display: "flex",
            gap: "0.35rem",
            alignItems: "flex-start",
            fontSize: "0.73rem",
            color: "var(--warning)",
            margin: "0.35rem 0 0",
          }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          Counted at its cover amount. That is paid out on death rather than money you hold now, so net worth is larger
          than what you could actually draw on.
        </p>
      )}

      {policy.valuations.length > 1 && (
        <div style={{ margin: "0.6rem 0 0" }}>
          <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
            Statements
          </p>
          {[...policy.valuations]
            .sort((a, b) => b.valued_at.localeCompare(a.valued_at))
            // Two statements can carry the same "as at" date, so the date
            // alone isn't a unique key.
            .map((valuation, index) => (
              <p key={`${valuation.valued_at}-${index}`} style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                {valuation.valued_at} —{" "}
                {valuation.surrender_value != null ? formatCurrency(valuation.surrender_value, policy.currency) : "no surrender value"}
                {valuation.cover_amount != null && ` · ${formatCurrency(valuation.cover_amount, policy.currency)} cover`}
              </p>
            ))}
        </div>
      )}

      {notice && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: "0.4rem 0 0" }}>{notice}</p>}

      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) readStatement(file);
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={reading}>
          {reading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} Newer statement
        </button>
        <button type="button" onClick={remove} disabled={busy}>
          <Trash2 size={13} /> Remove
        </button>
      </div>

      {facts && (
        <PolicyImportModal
          facts={facts}
          existing={policy}
          onClose={() => setFacts(null)}
          onSaved={() => {
            setFacts(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function Policies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [facts, setFacts] = useState<PolicyFacts | null>(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { refresh: signalWritten } = useRefresh();

  const load = useCallback(() => {
    api.listPolicies().then(setPolicies);
  }, []);

  useEffect(load, [load]);

  // After a write, not on first load: reload this page's own list *and* tell
  // the sidebar its net worth is stale. Both, always — what a policy
  // contributes is exactly the figure the sidebar shows, so a card that
  // updates while the total beside it does not is the outcome worth avoiding.
  // Kept apart from `load` so merely opening the page doesn't announce a
  // change that never happened.
  const refresh = useCallback(() => {
    load();
    signalWritten();
  }, [load, signalWritten]);

  async function readStatement(file: File) {
    setReading(true);
    setNotice(null);
    try {
      setFacts(await api.previewPolicyDocument(await fileToBase64(file)));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not read that document.");
    } finally {
      setReading(false);
    }
  }

  const widgets: WidgetSpec[] = [
    {
      id: "addPolicy",
      title: "Add a policy",
      icon: Upload,
      accentVar: "--accent-3",
      defaultWidth: 672,
      defaultHeight: 220,
      render: () => (
        <div>
          <p style={{ fontSize: "0.83rem", margin: "0 0 0.6rem" }}>
            Upload a policy statement or schedule. The cover amount, surrender value, premium and dates are read out of
            it and shown beside the wording they came from, for you to check before anything is saved.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) readStatement(file);
            }}
          />
          <button type="button" className="btn-accent" onClick={() => fileRef.current?.click()} disabled={reading}>
            {reading ? (
              <>
                <Loader2 size={14} className="spin" /> Reading the document…
              </>
            ) : (
              <>
                <Upload size={14} /> Choose a statement
              </>
            )}
          </button>
          {notice && <p style={{ fontSize: "0.8rem", color: "var(--critical)", marginTop: "0.5rem" }}>{notice}</p>}
          <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", marginTop: "0.6rem" }}>
            It has to be a text PDF rather than a scan — a photographed document has no text to read.
          </p>
        </div>
      ),
    },
    {
      id: "policies",
      title: "Your policies",
      icon: Umbrella,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 460,
      render: () =>
        policies.length === 0 ? (
          <p className="empty-state">No policies yet.</p>
        ) : (
          <>
            {policies.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onChanged={refresh} />
            ))}
          </>
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Policies</h1>
          <p className="page-header__subtitle">
            Life cover, and what it is worth · hold a card to move or resize it
          </p>
        </div>
      </div>

      <WidgetCanvas storageKey="policies.layout.v1" widgets={widgets} />

      {facts && (
        <PolicyImportModal
          facts={facts}
          onClose={() => setFacts(null)}
          onSaved={() => {
            setFacts(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
