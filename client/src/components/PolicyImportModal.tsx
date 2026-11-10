import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import PolicyFields from "./PolicyFields.js";
import { api, type Policy, type PolicyFacts } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";
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
 * A document can describe more than one policy, and usually does when it is a
 * schedule covering two lives. Each is confirmed separately here, under its own
 * heading, because they are separate policies with separate cover — and the
 * version of this screen that showed one set of fields silently produced a
 * policy that was neither of them.
 *
 * The inputs themselves are `PolicyFields`, shared with the typed-in-by-hand
 * screen so the two cannot drift. What belongs to this screen rather than that
 * one is everything about provenance: the quotes, the count of what was found,
 * and the warning when a document had to be read as images.
 */

interface Props {
  /** Every policy the document described. Never empty. */
  facts: PolicyFacts[];
  /** Set when this document is a newer statement for a policy already held. */
  existing?: Policy | null;
  onClose: () => void;
  onSaved: () => void;
}

function quotesFor(facts: PolicyFacts) {
  return {
    coverAmount: facts.coverAmount?.quote,
    surrenderValue: facts.surrenderValue?.quote,
    valuedAt: facts.valuedAt?.quote,
    premium: facts.premium?.quote,
    startDate: facts.startDate?.quote,
    maturityDate: facts.maturityDate?.quote,
  };
}

export default function PolicyImportModal({ facts, existing, onClose, onSaved }: Props) {
  // A newer statement is always for one policy — the one whose card it was
  // dropped on — so only the first reading applies to it.
  const readings = existing ? facts.slice(0, 1) : facts;

  const [drafts, setDrafts] = useState<PolicyDraftFields[]>(() =>
    readings.map((reading, index) => draftFromFacts(reading, existing, index))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = readings[0];
  const several = readings.length > 1;

  // A newer statement moves the figures and the premium; it does not restate
  // who the policy is with or when it was taken out. Those fields used to be
  // shown here and then thrown away by the valuations endpoint, which invited
  // an edit that silently did nothing.
  const blocks: PolicyBlocks = { identity: !existing, figures: true, term: !existing };

  const problems = drafts.map((draft) => draftProblem(draft, blocks));
  const problem = problems.find(Boolean) ?? null;

  const found = [first.coverAmount, first.surrenderValue, first.premium, first.startDate, first.maturityDate, first.valuedAt].filter(
    Boolean
  ).length;

  function update(index: number, next: PolicyDraftFields) {
    setDrafts((current) => current.map((draft, i) => (i === index ? next : draft)));
  }

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
        await api.addPolicyValuation(existing.id, toValuation(drafts[0]));
      } else {
        // One at a time rather than in parallel: if the second fails, the
        // first has still been created, and the list behind this modal is
        // about to be reloaded from the server either way.
        for (const [index, draft] of drafts.entries()) {
          await api.createPolicy(toCreate(draft, readings[index]));
        }
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
          <h2 className="modal__title">
            {existing ? `Newer statement — ${existing.name}` : several ? `${readings.length} policies in this document` : "Policy details"}
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {first.insurer ? `${first.insurer} · ` : ""}
            {several
              ? "Each is confirmed separately below — they have their own cover and are saved as separate policies."
              : `${found} of 6 figures found`}
            {first.keyTerms.length > 0 ? ` · ${first.keyTerms.length} other terms` : ""}
            {first.passes > 1 ? ` · read in ${first.passes} passes` : ""}. Check each against the wording it came from
            before saving.
          </p>
          {/* A scan has no text to match a quote against, so the usual
              "this sentence is in the document" check could not run. Saying so
              is the honest version of the same safeguard: the reading still
              has to be agreed to, only now the page is what it's agreed
              against. */}
          {first.readFrom === "scan" && (
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

        {readings.map((reading, index) => (
          <div key={`${reading.policyNumber ?? ""}-${reading.benefitName ?? index}`} style={{ padding: "0.5rem 1rem" }}>
            {several && (
              <div style={{ borderTop: index > 0 ? "1px solid var(--border)" : "none", paddingTop: index > 0 ? "0.9rem" : 0 }}>
                <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.15rem" }}>
                  {drafts[index].name || `Policy ${index + 1}`}
                </h3>
                {/* The document's own wording for this benefit. Two benefits
                    on one schedule share a policy number, so this is the only
                    thing that says which of them is which. */}
                {reading.benefitName && (
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                    {reading.benefitName}
                  </p>
                )}
              </div>
            )}
            <PolicyFields
              draft={drafts[index]}
              onChange={(next) => update(index, next)}
              blocks={blocks}
              quotes={quotesFor(reading)}
              missingQuoteNote="Not stated in the document — type it in if you know it."
            />
          </div>
        ))}

        {/* A combined premium belongs to no single policy, so it is shown and
            not divided. Splitting it evenly would be inventing the answer, and
            an invented premium feeds straight into the monthly plan. */}
        {several && first.totalPremium && (
          <p
            style={{
              display: "flex",
              gap: "0.4rem",
              alignItems: "flex-start",
              margin: "0.5rem 1rem",
              fontSize: "0.76rem",
              color: "var(--text-muted)",
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              The document also states a combined premium of{" "}
              {formatCurrency(first.totalPremium.value, first.currency ?? "EUR")} across these policies. It is shown
              rather than divided between them — it may include fees charged on the policy as a whole, so the parts
              need not add up to it.
            </span>
          </p>
        )}

        {/* Everything the document says beyond the figures. Not stored as
            fields — kept with the policy so the exclusions and waiting periods
            can be read once, while the document is in front of you. */}
        {first.keyTerms.length > 0 && (
          <div style={{ padding: "0.5rem 1rem" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>Also in this document ({first.keyTerms.length})</h3>
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {first.keyTerms.map((term) => (
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
            {saving ? (
              <Loader2 size={14} className="spin" />
            ) : existing ? (
              "Record this statement"
            ) : several ? (
              `Save ${readings.length} policies`
            ) : (
              "Save this policy"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
