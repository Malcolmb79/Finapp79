import { AlertTriangle, Loader2, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Category, type StatementMapping, type StatementPreview } from "../api/client.js";

// Marker value for the "add a category" option in a row's dropdown. Not a
// valid id, so it can never collide with a real category.
const NEW_CATEGORY = "__new__";

/**
 * Confirms how a statement file will be read before anything is written.
 *
 * The server's inferred mapping is a guess about someone's money — day/month
 * the wrong way round, or a debit column read with the wrong sign, produces
 * rows that look plausible and are quietly wrong. Every field is editable, and
 * the sample below re-parses on each change, so the mapping is checked against
 * real rows rather than accepted on trust.
 */
export default function StatementImportModal({
  accountId,
  accountName,
  filename,
  contentBase64,
  onClose,
  onImported,
}: {
  accountId: string;
  accountName: string;
  filename: string;
  /** The uploaded file's raw bytes, base64-encoded — CSV or PDF alike. */
  contentBase64: string;
  onClose: () => void;
  onImported: (result: { imported: number; duplicates: number; brandedAs: string | null }) => void;
}) {
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Defaults on: if a bank was confidently matched, branding the account is
  // almost always wanted — but it's visible and switchable before importing.
  const [applyLogo, setApplyLogo] = useState(true);

  const [categories, setCategories] = useState<Category[]>([]);
  // Per-row category, keyed by row index. Only rows the user (or a suggestion)
  // has actually set appear here, so an untouched row imports uncategorised.
  const [rowCategories, setRowCategories] = useState<Record<number, number | null>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [proposed, setProposed] = useState<string[]>([]);
  // Which row is mid-way through creating a category, and the name being typed.
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => {
    api.listCategories().then(setCategories);
  }, []);
  // Guards against an earlier re-preview landing after a later one and
  // overwriting it with a stale sample.
  const requestId = useRef(0);

  // First pass: no mapping supplied, so the server infers one.
  useEffect(() => {
    let cancelled = false;
    api
      .previewStatement(accountId, contentBase64)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setMapping(result.mapping);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, contentBase64]);

  // Re-preview whenever the user edits the mapping. The supplied mapping means
  // the server skips inference, so this is a cheap parse, not another model call.
  function update(patch: Partial<StatementMapping>) {
    if (!mapping) return;
    const next = { ...mapping, ...patch };
    setMapping(next);
    const id = ++requestId.current;
    api
      .previewStatement(accountId, contentBase64, next)
      .then((result) => {
        if (id === requestId.current) setPreview(result);
      })
      .catch((e) => id === requestId.current && setError(e instanceof Error ? e.message : String(e)));
  }

  async function suggestCategories() {
    if (!mapping || !preview) return;
    setSuggesting(true);
    setError(null);
    try {
      const result = await api.categoriseStatement(accountId, contentBase64, mapping);
      // Only fills rows the user hasn't already decided — a suggestion must
      // never overwrite a choice they've made.
      setRowCategories((current) => {
        const next = { ...current };
        result.suggestions.forEach((s, index) => {
          if (s.categoryId != null && !(index in next)) next[index] = s.categoryId;
        });
        return next;
      });
      setProposed(result.proposed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  async function createCategory(name: string, forRow: number | null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    const category = existing ?? (await api.createCategory(trimmed));
    if (!existing) setCategories((cs) => [...cs, category].sort((a, b) => a.name.localeCompare(b.name)));
    setProposed((p) => p.filter((n) => n.toLowerCase() !== trimmed.toLowerCase()));
    if (forRow != null) setRowCategories((current) => ({ ...current, [forRow]: category.id }));
    setCreatingFor(null);
    setNewCategoryName("");
    return category;
  }

  async function confirm() {
    if (!mapping || !preview) return;
    setImporting(true);
    setError(null);
    try {
      const perRow = preview.sample.map((_, index) => rowCategories[index] ?? null);
      const result = await api.importStatement(
        accountId,
        contentBase64,
        mapping,
        applyLogo && !!preview.detectedBank,
        perRow
      );
      onImported(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const columnOptions = preview?.columns ?? [];
  const splitColumns = mapping ? mapping.amountColumn == null : false;

  function columnSelect(value: number | null, onChange: (v: number | null) => void, allowNone: boolean) {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: "100%" }}
      >
        {allowNone && <option value="">None</option>}
        {columnOptions.map((c) => (
          <option key={c.index} value={c.index}>
            {c.label || `Column ${c.index + 1}`}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} onClick={onClose} />
      <div
        role="dialog"
        aria-label="Confirm statement import"
        style={{
          position: "fixed",
          zIndex: 61,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(760px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 3rem)",
          overflow: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow)",
          padding: "1.25rem",
        }}
      >
        <h2 style={{ margin: 0 }}>Import statement</h2>
        <p className="page-header__subtitle" style={{ marginTop: "0.25rem" }}>
          {filename} → {accountName}
        </p>

        {error && (
          <p role="alert" style={{ color: "var(--critical)", fontSize: "0.85rem" }}>
            {error}
          </p>
        )}

        {!preview || !mapping ? (
          <p className="empty-state" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Loader2 size={14} className="spin" /> Working out the layout…
          </p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.82rem",
                color: "var(--text-secondary)",
                margin: "0.5rem 0 1rem",
              }}
            >
              {mapping.source === "ai" && <Sparkles size={13} />}
              {mapping.source === "ai" ? "Layout detected automatically" : "Layout matched from column names"} —{" "}
              <strong>{preview.parsed}</strong> transactions found
              {preview.ignored > 0 && `, ${preview.ignored} rows ignored`}. Check the preview below before importing.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
              <label>
                Date column
                {columnSelect(mapping.dateColumn, (v) => update({ dateColumn: v ?? 0 }), false)}
              </label>
              <label>
                Date format
                <select value={mapping.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as StatementMapping["dateFormat"] })} style={{ width: "100%" }}>
                  <option value="dmy">Day first (31/12/2026)</option>
                  <option value="mdy">Month first (12/31/2026)</option>
                  <option value="iso">ISO (2026-12-31)</option>
                </select>
              </label>
              <label>
                Amount columns
                <select
                  value={splitColumns ? "split" : "single"}
                  onChange={(e) =>
                    update(
                      e.target.value === "single"
                        ? { amountColumn: mapping.debitColumn ?? 0, debitColumn: null, creditColumn: null }
                        : { amountColumn: null, debitColumn: mapping.amountColumn ?? 0, creditColumn: null }
                    )
                  }
                  style={{ width: "100%" }}
                >
                  <option value="single">One signed column</option>
                  <option value="split">Separate money in / out</option>
                </select>
              </label>

              {splitColumns ? (
                <>
                  <label>
                    Money out
                    {columnSelect(mapping.debitColumn, (v) => update({ debitColumn: v }), true)}
                  </label>
                  <label>
                    Money in
                    {columnSelect(mapping.creditColumn, (v) => update({ creditColumn: v }), true)}
                  </label>
                </>
              ) : (
                <label>
                  Amount
                  {columnSelect(mapping.amountColumn, (v) => update({ amountColumn: v }), false)}
                </label>
              )}

              <label>
                Description
                {columnSelect(mapping.descriptionColumn, (v) => update({ descriptionColumn: v }), true)}
              </label>
              <label>
                Payee
                {columnSelect(mapping.counterpartyColumn, (v) => update({ counterpartyColumn: v }), true)}
              </label>
              <label>
                Decimal separator
                <select value={mapping.decimalSeparator} onChange={(e) => update({ decimalSeparator: e.target.value as "." | "," })} style={{ width: "100%" }}>
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </select>
              </label>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.75rem", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => update({ hasHeader: e.target.checked })} />
              First row is a header
            </label>

            {preview.detectedBank && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "0.5rem",
                  fontSize: "0.85rem",
                  padding: "0.5rem 0.6rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                }}
              >
                <input type="checkbox" checked={applyLogo} onChange={(e) => setApplyLogo(e.target.checked)} />
                {preview.detectedBank.logo && (
                  <img
                    src={preview.detectedBank.logo}
                    alt=""
                    style={{ width: 22, height: 22, borderRadius: 5, objectFit: "contain", background: "#fff" }}
                  />
                )}
                Use <strong>{preview.detectedBank.name}</strong>'s logo for this account
              </label>
            )}

            {/* An account mismatch is the one error a row-by-row preview can
                never show: every row is correct, they're just about to land
                against the wrong account. */}
            {preview.check.accountMatches === false && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  margin: "0.75rem 0",
                  padding: "0.6rem 0.75rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--critical)",
                  background: "color-mix(in srgb, var(--critical) 12%, transparent)",
                  fontSize: "0.85rem",
                }}
              >
                <AlertTriangle size={15} color="var(--critical)" />
                <span>
                  This statement is for account <strong>{preview.check.accountNumber}</strong>, which doesn't match{" "}
                  <strong>{accountName}</strong>. Check you've picked the right account before importing.
                </span>
              </div>
            )}

            {(preview.check.periodStart || preview.check.outsidePeriod > 0) && (
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", margin: "0.5rem 0" }}>
                {preview.check.periodStart && (
                  <>
                    Covers <strong>{preview.check.periodStart}</strong> to <strong>{preview.check.periodEnd}</strong>
                    {preview.check.accountMatches === true && preview.check.accountNumber && (
                      <> · account {preview.check.accountNumber} ✓</>
                    )}
                  </>
                )}
                {preview.check.outsidePeriod > 0 && (
                  <>
                    {" "}
                    · <strong>{preview.check.outsidePeriod}</strong> row
                    {preview.check.outsidePeriod === 1 ? "" : "s"} fall outside that period
                  </>
                )}
              </p>
            )}

            {preview.parsed > 1 && (preview.direction.inflow === 0 || preview.direction.outflow === 0) && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  flexWrap: "wrap",
                  margin: "0.75rem 0",
                  padding: "0.6rem 0.75rem",
                  borderRadius: "var(--radius)",
                  // Everything-is-income is the one that quietly wrecks a
                  // ledger, so it gets the louder treatment; an all-spending
                  // statement is perfectly normal for a card export.
                  border: `1px solid ${preview.direction.outflow === 0 ? "var(--critical)" : "var(--border)"}`,
                  background:
                    preview.direction.outflow === 0
                      ? "color-mix(in srgb, var(--critical) 12%, transparent)"
                      : "var(--surface-2)",
                }}
              >
                <AlertTriangle size={15} color={preview.direction.outflow === 0 ? "var(--critical)" : "var(--text-muted)"} />
                <span style={{ flex: 1, minWidth: 220, fontSize: "0.85rem" }}>
                  {preview.direction.outflow === 0 ? (
                    <>
                      All <strong>{preview.parsed}</strong> transactions are <strong>money in</strong>. If this is a spending
                      statement, its amounts are unsigned and they should all be money out.
                    </>
                  ) : (
                    <>
                      All <strong>{preview.parsed}</strong> transactions are <strong>money out</strong>. Normal for a card
                      statement — flip them if that's wrong.
                    </>
                  )}
                </span>
                <button onClick={() => update({ invertAmounts: !mapping.invertAmounts })}>
                  {mapping.invertAmounts ? "Undo flip" : `Flip all to money ${preview.direction.outflow === 0 ? "out" : "in"}`}
                </button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>
                {preview.parsed} transaction{preview.parsed === 1 ? "" : "s"} to import
              </h3>
              <button onClick={suggestCategories} disabled={suggesting || preview.parsed === 0}>
                {suggesting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                Suggest categories
              </button>
            </div>
            {preview.sample.length === 0 ? (
              <p className="empty-state">
                No transactions read with this mapping — check the date column and format.
              </p>
            ) : (
              <>
                {proposed.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Suggested new categories:</span>
                    {proposed.map((name) => (
                      <button key={name} onClick={() => createCategory(name, null)} style={{ fontSize: "0.8rem" }}>
                        <Plus size={12} />
                        {name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Scrolls within the dialog so the whole statement is
                    reviewable without the controls above scrolling away. */}
                <div style={{ maxHeight: "40vh", overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                  {preview.sample.map((row, i) => (
                    <div className="tx-row" key={i}>
                      <div className="tx-row__info">
                        <div className="tx-row__name">{row.description || row.counterparty || "—"}</div>
                        <div className="tx-row__meta">
                          {row.date}
                          {row.counterparty && row.description ? ` · ${row.counterparty}` : ""}
                        </div>
                      </div>

                      {creatingFor === i ? (
                        <input
                          autoFocus
                          value={newCategoryName}
                          placeholder="New category"
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") createCategory(newCategoryName, i);
                            if (e.key === "Escape") {
                              setCreatingFor(null);
                              setNewCategoryName("");
                            }
                          }}
                          onBlur={() => createCategory(newCategoryName, i)}
                          style={{ maxWidth: 150, fontSize: "0.82rem" }}
                        />
                      ) : (
                        <select
                          value={rowCategories[i] ?? ""}
                          onChange={(e) => {
                            if (e.target.value === NEW_CATEGORY) {
                              setNewCategoryName("");
                              setCreatingFor(i);
                              return;
                            }
                            setRowCategories((current) => ({
                              ...current,
                              [i]: e.target.value ? Number(e.target.value) : null,
                            }));
                          }}
                          style={{ maxWidth: 150, fontSize: "0.82rem" }}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          <option value={NEW_CATEGORY}>+ New category…</option>
                        </select>
                      )}

                      <span className={`tx-row__amount${row.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
                        {row.amount >= 0 ? "+" : ""}
                        {row.amount.toFixed(2)} {preview.currency}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

          </>
        )}

        {/* Outside the loaded-preview branch on purpose: while the preview is
            still resolving, or if it failed, there must still be a way out of
            the dialog and a visible primary action. */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border)",
            position: "sticky",
            bottom: 0,
            background: "var(--surface-1)",
          }}
        >
          <button onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button className="btn-accent" onClick={confirm} disabled={importing || !preview || preview.parsed === 0}>
            {importing ? <Loader2 size={14} className="spin" /> : null}
            {preview ? `Import ${preview.parsed} transaction${preview.parsed === 1 ? "" : "s"}` : "Import"}
          </button>
        </div>
      </div>
    </>
  );
}
