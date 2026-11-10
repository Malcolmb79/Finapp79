import type { PolicyBlocks, PolicyDraftFields } from "../utils/policyDraft.js";

/**
 * The fields a policy consists of, rendered once for both ways of entering one.
 *
 * A policy can be read out of a statement or typed in by hand. Those are two
 * screens, and if each owned its own inputs they would drift — a field added to
 * one and forgotten on the other wouldn't break anything, it would just quietly
 * become impossible to record that way. So the markup lives here and the two
 * screens differ only in what wraps it: quotes and a provenance warning on the
 * import side, nothing on the manual side.
 *
 * `quotes` is what makes the import version what it is. Where a figure was read
 * out of prose, the sentence it came from is printed under it, because that is
 * the only check worth anything on an extracted number. Typed in by hand there
 * is no sentence, and inventing a reassuring one would be worse than the blank.
 */

interface Props {
  draft: PolicyDraftFields;
  onChange: (next: PolicyDraftFields) => void;
  blocks: PolicyBlocks;
  /** The sentence each figure was read from, when it was read rather than typed. */
  quotes?: Partial<Record<keyof PolicyDraftFields, string | undefined>>;
  /** Shown under a figure that has no quote, on the import path only. */
  missingQuoteNote?: string;
}

const LABEL_WIDTH = 138;

const rowStyle = { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" } as const;
const inputStyle = { flex: 1, fontSize: "0.85rem", padding: "0.3rem 0.45rem" } as const;
const noteStyle = { margin: 0, marginLeft: LABEL_WIDTH, fontSize: "0.72rem", color: "var(--text-muted)" } as const;

function Quote({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        marginLeft: LABEL_WIDTH,
        fontSize: "0.75rem",
        color: "var(--text-muted)",
        fontStyle: "italic",
        borderLeft: "2px solid var(--border)",
        paddingLeft: "0.5rem",
      }}
    >
      &ldquo;{text}&rdquo;
    </p>
  );
}

export default function PolicyFields({ draft, onChange, blocks, quotes, missingQuoteNote }: Props) {
  const set = <K extends keyof PolicyDraftFields>(key: K, value: PolicyDraftFields[K]) =>
    onChange({ ...draft, [key]: value });

  /** A figure's supporting line: its quote, or the note for a missing one. */
  const provenance = (key: keyof PolicyDraftFields) => {
    if (!quotes) return null;
    const quote = quotes[key];
    if (quote) return <Quote text={quote} />;
    return missingQuoteNote ? <p style={noteStyle}>{missingQuoteNote}</p> : null;
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {blocks.identity && (
        <>
          <label style={rowStyle}>
            <span style={{ minWidth: LABEL_WIDTH }}>Name</span>
            <input
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Life cover"
              style={inputStyle}
            />
          </label>
          <label style={rowStyle}>
            <span style={{ minWidth: LABEL_WIDTH }}>Insurer</span>
            <input
              value={draft.insurer}
              onChange={(e) => set("insurer", e.target.value)}
              placeholder="who it is with"
              style={inputStyle}
            />
          </label>
          <label style={rowStyle}>
            <span style={{ minWidth: LABEL_WIDTH }}>Policy number</span>
            <input
              value={draft.policyNumber}
              onChange={(e) => set("policyNumber", e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </label>
          <label style={rowStyle}>
            <span style={{ minWidth: LABEL_WIDTH }}>Currency</span>
            <input
              value={draft.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
              style={{ width: 80, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
            />
          </label>
        </>
      )}

      {blocks.figures && (
        <>
          {/* The two figures, always together and always labelled for what
              they are. Side by side on purpose: seeing "pays out on death"
              next to "worth if cashed in today" is what stops the two being
              typed into each other's box. */}
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label style={rowStyle}>
              <span style={{ minWidth: LABEL_WIDTH }}>Cover amount</span>
              <input
                value={draft.coverAmount}
                onChange={(e) => set("coverAmount", e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                style={{ width: 150, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
              />
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{draft.currency}</span>
            </label>
            <p style={noteStyle}>The sum assured — what pays out on death. Not money you hold now.</p>
            {provenance("coverAmount")}
          </div>

          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label style={rowStyle}>
              <span style={{ minWidth: LABEL_WIDTH }}>Surrender value</span>
              <input
                value={draft.surrenderValue}
                onChange={(e) => set("surrenderValue", e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                style={{ width: 150, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
              />
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{draft.currency}</span>
            </label>
            <p style={noteStyle}>
              What it is worth if cashed in today. A term policy has none — leave it blank rather than putting a zero.
            </p>
            {provenance("surrenderValue")}
          </div>

          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label style={rowStyle}>
              <span style={{ minWidth: LABEL_WIDTH }}>Figures as at</span>
              <input
                type="date"
                value={draft.valuedAt}
                onChange={(e) => set("valuedAt", e.target.value)}
                style={{ width: 160, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
              />
            </label>
            <p style={noteStyle}>
              The date those two figures were true on. It is what lets the net worth trend show the policy from then
              onward instead of across months you didn&apos;t hold it.
            </p>
            {provenance("valuedAt")}
          </div>
        </>
      )}

      <div style={{ display: "grid", gap: "0.25rem" }}>
        <label style={rowStyle}>
          <span style={{ minWidth: LABEL_WIDTH }}>Premium</span>
          <input
            value={draft.premium}
            onChange={(e) => set("premium", e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            style={{ width: 150, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
          />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{draft.currency}</span>
          <select
            value={draft.premiumFrequency}
            onChange={(e) => set("premiumFrequency", e.target.value as PolicyDraftFields["premiumFrequency"])}
            style={{ fontSize: "0.8rem", padding: "0.25rem" }}
            aria-label="How often the premium is paid"
          >
            <option value="">how often?</option>
            <option value="monthly">a month</option>
            <option value="quarterly">a quarter</option>
            <option value="annual">a year</option>
          </select>
        </label>
        {provenance("premium")}
      </div>

      {blocks.term && (
        <>
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label style={rowStyle}>
              <span style={{ minWidth: LABEL_WIDTH }}>Started</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                style={{ width: 160, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
              />
            </label>
            {provenance("startDate")}
          </div>

          <div style={{ display: "grid", gap: "0.25rem" }}>
            <label style={rowStyle}>
              <span style={{ minWidth: LABEL_WIDTH }}>Matures</span>
              <input
                type="date"
                value={draft.maturityDate}
                onChange={(e) => set("maturityDate", e.target.value)}
                style={{ width: 160, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
              />
            </label>
            {provenance("maturityDate")}
          </div>
        </>
      )}
    </div>
  );
}
