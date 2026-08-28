import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type NetWorthSource, type Policy, type PolicyFacts } from "../api/client.js";

/**
 * Confirms what was read out of a policy document before any of it is stored.
 *
 * Every figure is shown beside the sentence it was read from, for the same
 * reason the loan contract screen does it: these values came out of prose
 * rather than a column, so the only real check is a person reading the sentence
 * and agreeing it says what the figure claims.
 *
 * The cover amount and the surrender value are shown as two separate rows, and
 * never fall back to one another. That is the whole point of the screen: a term
 * policy states a large cover and no cash value at all, and the difference
 * between the two is the difference between a policy that adds to what you own
 * and one that doesn't.
 */

interface Props {
  facts: PolicyFacts;
  /** Set when this document is a newer statement for a policy already held. */
  existing?: Policy | null;
  onClose: () => void;
  onSaved: () => void;
}

type Draft = {
  name: string;
  insurer: string;
  policyNumber: string;
  currency: string;
  coverAmount: string;
  surrenderValue: string;
  valuedAt: string;
  premium: string;
  premiumFrequency: "" | "monthly" | "quarterly" | "annual";
  startDate: string;
  maturityDate: string;
  netWorthSource: NetWorthSource;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initialDraft(facts: PolicyFacts, existing?: Policy | null): Draft {
  return {
    name: existing?.name ?? facts.insurer ?? "Life policy",
    insurer: existing?.insurer ?? facts.insurer ?? "",
    policyNumber: existing?.policy_number ?? facts.policyNumber ?? "",
    currency: existing?.currency ?? facts.currency ?? "USD",
    coverAmount: facts.coverAmount ? String(facts.coverAmount.value) : "",
    surrenderValue: facts.surrenderValue ? String(facts.surrenderValue.value) : "",
    // A statement with no stated "as at" is dated today: the figure became
    // known now, which is the honest claim available.
    valuedAt: facts.valuedAt?.value ?? today(),
    premium: facts.premium ? String(facts.premium.value) : "",
    premiumFrequency: facts.premiumFrequency ?? "",
    startDate: facts.startDate?.value ?? "",
    maturityDate: facts.maturityDate?.value ?? "",
    // Never guessed from what was found. A policy stays out of every total
    // until it is explicitly asked in — see utils/policyValue.ts.
    netWorthSource: existing?.net_worth_source ?? "none",
  };
}

function number(value: string): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, "");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function PolicyImportModal({ facts, existing, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(facts, existing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = [facts.coverAmount, facts.surrenderValue, facts.premium, facts.startDate, facts.maturityDate, facts.valuedAt].filter(
    Boolean
  ).length;

  const surrender = number(draft.surrenderValue);
  const cover = number(draft.coverAmount);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        // A newer statement for a policy already held: the figures move, the
        // policy's identity and its net worth choice do not.
        await api.addPolicyValuation(existing.id, {
          valued_at: draft.valuedAt || today(),
          cover_amount: cover,
          surrender_value: surrender,
          // A newer statement is where a premium escalation shows up, so it
          // travels with the figures rather than being left behind on the
          // policy — otherwise the monthly plan keeps using last year's.
          premium: number(draft.premium),
          premium_frequency: draft.premiumFrequency || null,
        });
      } else {
        await api.createPolicy({
          name: draft.name.trim() || "Life policy",
          insurer: draft.insurer.trim() || null,
          policy_number: draft.policyNumber.trim() || null,
          currency: draft.currency.trim().toUpperCase() || "USD",
          cover_amount: cover,
          surrender_value: surrender,
          valued_at: draft.valuedAt || null,
          premium: number(draft.premium),
          premium_frequency: draft.premiumFrequency || null,
          start_date: draft.startDate || null,
          maturity_date: draft.maturityDate || null,
          net_worth_source: draft.netWorthSource,
          extract: facts,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this policy.");
    } finally {
      setSaving(false);
    }
  }

  const rows: { key: keyof Draft; label: string; quote: string | undefined; type: string; suffix?: string; hint?: string }[] = [
    {
      key: "coverAmount",
      label: "Cover amount",
      quote: facts.coverAmount?.quote,
      type: "text",
      suffix: draft.currency,
      hint: "The sum assured — what pays out on death.",
    },
    {
      key: "surrenderValue",
      label: "Surrender value",
      quote: facts.surrenderValue?.quote,
      type: "text",
      suffix: draft.currency,
      hint: "What the policy is worth if cashed in today. A term policy has none — leave it blank.",
    },
    { key: "valuedAt", label: "Figures as at", quote: facts.valuedAt?.quote, type: "date" },
    { key: "premium", label: "Premium", quote: facts.premium?.quote, type: "text", suffix: draft.currency },
    { key: "startDate", label: "Started", quote: facts.startDate?.quote, type: "date" },
    { key: "maturityDate", label: "Matures", quote: facts.maturityDate?.quote, type: "date" },
  ];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal__header">
          <h2 className="modal__title">
            {existing ? `Newer statement — ${existing.name}` : "Policy details"}
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {facts.insurer ? `${facts.insurer} · ` : ""}
            {found} of 6 figures found
            {facts.keyTerms.length > 0 ? `, plus ${facts.keyTerms.length} other terms` : ""}
            {facts.passes > 1 ? ` · read in ${facts.passes} passes` : ""}. Check each against the wording it came from
            before saving.
          </p>
        </div>

        <div style={{ padding: "0.5rem 1rem", display: "grid", gap: "0.75rem" }}>
          {!existing && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  style={{ flex: 1, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>Insurer</span>
                <input
                  value={draft.insurer}
                  onChange={(e) => setDraft((d) => ({ ...d, insurer: e.target.value }))}
                  placeholder="not found"
                  style={{ flex: 1, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>Policy number</span>
                <input
                  value={draft.policyNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, policyNumber: e.target.value }))}
                  placeholder="not found"
                  style={{ flex: 1, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>Currency</span>
                <input
                  value={draft.currency}
                  onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) }))}
                  style={{ width: 80, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
              </label>
            </>
          )}

          {rows.map((row) => (
            <div key={row.key} style={{ display: "grid", gap: "0.25rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>{row.label}</span>
                <input
                  type={row.type}
                  value={draft[row.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                  placeholder="not found"
                  style={{ width: row.type === "date" ? 150 : 140, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
                {row.suffix && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{row.suffix}</span>}
                {row.key === "premium" && (
                  <select
                    value={draft.premiumFrequency}
                    onChange={(e) => setDraft((d) => ({ ...d, premiumFrequency: e.target.value as Draft["premiumFrequency"] }))}
                    style={{ fontSize: "0.8rem", padding: "0.25rem" }}
                  >
                    <option value="">how often?</option>
                    <option value="monthly">a month</option>
                    <option value="quarterly">a quarter</option>
                    <option value="annual">a year</option>
                  </select>
                )}
              </label>
              {row.hint && (
                <p style={{ margin: 0, marginLeft: 138, fontSize: "0.72rem", color: "var(--text-muted)" }}>{row.hint}</p>
              )}
              {row.quote ? (
                <p
                  style={{
                    margin: 0,
                    marginLeft: 138,
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    borderLeft: "2px solid var(--border)",
                    paddingLeft: "0.5rem",
                  }}
                >
                  “{row.quote}”
                </p>
              ) : (
                <p style={{ margin: 0, marginLeft: 138, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Not stated in the document — type it in if you know it.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Everything the document says beyond the figures. Not stored as
            fields — kept with the policy so the exclusions and waiting periods
            can be read once, while the document is in front of you. */}
        {facts.keyTerms.length > 0 && (
          <div style={{ padding: "0.5rem 1rem" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>Also in this document ({facts.keyTerms.length})</h3>
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {facts.keyTerms.map((term) => (
                <div key={term.quote} style={{ borderLeft: "2px solid var(--border)", paddingLeft: "0.6rem" }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{term.label}</div>
                  <div style={{ fontSize: "0.8rem" }}>{term.detail}</div>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.73rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    “{term.quote}”
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p
          style={{
            display: "flex",
            gap: "0.4rem",
            alignItems: "flex-start",
            margin: "0.5rem 1rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          Read from the document&apos;s wording rather than from a column of figures. Every quote here was checked
          against the file, but only you can confirm it means what it appears to — check each against your own copy.
        </p>

        {error && <p style={{ margin: "0 1rem", fontSize: "0.8rem", color: "var(--critical)" }}>{error}</p>}

        <div className="modal__footer">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-accent" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : existing ? "Record this statement" : "Save this policy"}
          </button>
        </div>
      </div>
    </div>
  );
}
