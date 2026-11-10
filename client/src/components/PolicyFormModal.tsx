import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import PolicyFields from "./PolicyFields.js";
import { api, type Policy } from "../api/client.js";
import {
  draftFromPolicy,
  draftProblem,
  emptyDraft,
  toCreate,
  toPatch,
  toValuation,
  type PolicyBlocks,
  type PolicyDraftFields,
} from "../utils/policyDraft.js";

/**
 * A policy typed in by hand.
 *
 * Reading a statement is the pleasant path, and it was the only path. That left
 * three ordinary situations with nowhere to go: a policy whose paperwork is in a
 * drawer rather than a PDF, an old policy with no statement at hand, and a
 * deployment with no AI key at all — where the server already answers "you can
 * still enter the figures by hand", which until now was not true.
 *
 * Three modes, and the split between them is not cosmetic:
 *
 *   **create** — everything, in one request. The server records the first
 *   valuation alongside the policy, so the card and the net worth trend agree
 *   from the moment it exists.
 *
 *   **details** — who the policy is with, what it costs, when it runs. Writes
 *   through PATCH, and deliberately cannot touch the two figures.
 *
 *   **figures** — a new cover amount or surrender value, written as a dated
 *   valuation rather than an edit. This is the one that matters: the card's
 *   headline reads the policy's own columns while the net worth trend reads the
 *   valuation history, so an edited figure would move one and not the other,
 *   and the two would disagree from then on with nothing on screen to explain
 *   it. Recording a valuation updates both. See `toPatch` in
 *   utils/policyDraft.ts.
 */

export type PolicyFormMode = "create" | "details" | "figures";

interface Props {
  mode: PolicyFormMode;
  /** The policy being changed. Absent only when creating. */
  policy?: Policy | null;
  /** Seeds the currency of a new policy, so the first one doesn't set a trap. */
  defaultCurrency?: string;
  onClose: () => void;
  onSaved: () => void;
}

const BLOCKS: Record<PolicyFormMode, PolicyBlocks> = {
  create: { identity: true, figures: true, term: true },
  details: { identity: true, figures: false, term: true },
  figures: { identity: false, figures: true, term: false },
};

const TITLE: Record<PolicyFormMode, string> = {
  create: "Add a policy by hand",
  details: "Edit details",
  figures: "Record figures",
};

const ACTION: Record<PolicyFormMode, string> = {
  create: "Save this policy",
  details: "Save changes",
  figures: "Record these figures",
};

export default function PolicyFormModal({ mode, policy, defaultCurrency, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<PolicyDraftFields>(() =>
    policy ? draftFromPolicy(policy) : emptyDraft(defaultCurrency)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocks = BLOCKS[mode];
  const problem = draftProblem(draft, blocks);

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        await api.createPolicy(toCreate(draft));
      } else if (mode === "details") {
        await api.updatePolicy(policy!.id, toPatch(draft));
      } else {
        await api.addPolicyValuation(policy!.id, toValuation(draft));
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
            {TITLE[mode]}
            {policy ? ` — ${policy.name}` : ""}
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {mode === "create" &&
              "Everything is optional except the name. Leave a figure blank rather than putting a zero in it — blank means not known, zero means genuinely nothing."}
            {mode === "details" &&
              "Who the policy is with, what it costs and when it runs. The cover amount and surrender value are recorded separately, with the date they were true on."}
            {mode === "figures" &&
              "Kept as a dated statement rather than an edit, so the value can be seen moving and the net worth trend shows the policy from each figure onward."}
          </p>
        </div>

        <div style={{ padding: "0.5rem 1rem" }}>
          <PolicyFields draft={draft} onChange={setDraft} blocks={blocks} />
        </div>

        {/* Said once, on the way in. The card repeats it for whichever figure
            was chosen, but the choice is easier to make while both numbers are
            still in front of you. */}
        {mode === "create" && (
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
            Saved out of every total to begin with. Once it is here you can choose on the card whether it counts
            towards net worth, and at which of the two figures.
          </p>
        )}

        {/* A policy whose figures predate its own history: the valuation is
            filed under its own date, so an older one updates the trail without
            moving the headline. Worth saying, because entering last year's
            statement and seeing the card not change looks like a failure. */}
        {mode === "figures" && policy?.valued_at && draft.valuedAt && draft.valuedAt < policy.valued_at && (
          <p style={{ margin: "0.5rem 1rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            This is older than the figures on record ({policy.valued_at}), so it will be added to the history without
            changing what the card shows now.
          </p>
        )}

        {error && <p style={{ margin: "0 1rem", fontSize: "0.8rem", color: "var(--critical)" }}>{error}</p>}

        <div className="modal__footer">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-accent" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : ACTION[mode]}
          </button>
        </div>
      </div>
    </div>
  );
}
