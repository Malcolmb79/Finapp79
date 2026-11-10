import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import PolicyFields from "./PolicyFields.js";
import { api, type Policy, type PolicyFacts } from "../api/client.js";
import {
  draftFromFacts,
  draftProblem,
  toCreate,
  toValuation,
  type PolicyBlocks,
  type PolicyDraftFields,
} from "../utils/policyDraft.js";

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
 *
 * The inputs themselves are `PolicyFields`, shared with the typed-in-by-hand
 * screen so the two cannot drift. What belongs to this screen rather than that
 * one is everything about provenance: the quotes, the count of what was found,
 * and the warning when the document had to be read as images.
 */

interface Props {
  facts: PolicyFacts;
  /** Set when this document is a newer statement for a policy already held. */
  existing?: Policy | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function PolicyImportModal({ facts, existing, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<PolicyDraftFields>(() => draftFromFacts(facts, existing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = [facts.coverAmount, facts.surrenderValue, facts.premium, facts.startDate, facts.maturityDate, facts.valuedAt].filter(
    Boolean
  ).length;

  // A newer statement moves the figures and the premium; it does not restate
  // who the policy is with or when it was taken out. Those fields used to be
  // shown here and then thrown away by the valuations endpoint, which invited
  // an edit that silently did nothing.
  const blocks: PolicyBlocks = { identity: !existing, figures: true, term: !existing };

  const problem = draftProblem(draft, blocks);

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        // A newer statement for a policy already held: the figures move, the
        // policy's identity and its net worth choice do not. The premium
        // travels with the figures rather than being left behind — a
        // statement is where an escalation shows up, and without it the
        // monthly plan keeps using last year's.
        await api.addPolicyValuation(existing.id, toValuation(draft));
      } else {
        await api.createPolicy(toCreate(draft, facts));
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal__header">
          <h2 className="modal__title">{existing ? `Newer statement — ${existing.name}` : "Policy details"}</h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {facts.insurer ? `${facts.insurer} · ` : ""}
            {found} of 6 figures found
            {facts.keyTerms.length > 0 ? `, plus ${facts.keyTerms.length} other terms` : ""}
            {facts.passes > 1 ? ` · read in ${facts.passes} passes` : ""}. Check each against the wording it came from
            before saving.
          </p>
          {/* A scan has no text to match a quote against, so the usual
              "this sentence is in the document" check could not run. Saying so
              is the honest version of the same safeguard: the reading still
              has to be agreed to, only now the page is what it's agreed
              against. */}
          {facts.readFrom === "scan" && (
            <p
              style={{
                fontSize: "0.78rem",
                color: "var(--text-muted)",
                margin: "0.4rem 0 0",
                display: "flex",
                alignItems: "flex-start",
                gap: "0.35rem",
              }}
            >
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                This document has no text in it, so its pages were read as images. The wording below is a
                transcription rather than a match against the file — worth comparing to the statement itself.
              </span>
            </p>
          )}
        </div>

        <div style={{ padding: "0.5rem 1rem" }}>
          <PolicyFields
            draft={draft}
            onChange={setDraft}
            blocks={blocks}
            quotes={{
              coverAmount: facts.coverAmount?.quote,
              surrenderValue: facts.surrenderValue?.quote,
              valuedAt: facts.valuedAt?.quote,
              premium: facts.premium?.quote,
              startDate: facts.startDate?.quote,
              maturityDate: facts.maturityDate?.quote,
            }}
            missingQuoteNote="Not stated in the document — type it in if you know it."
          />
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
                    &ldquo;{term.quote}&rdquo;
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
