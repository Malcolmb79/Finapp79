import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type StatementMapping, type StatementPreview } from "../api/client.js";

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
  content,
  onClose,
  onImported,
}: {
  accountId: string;
  accountName: string;
  filename: string;
  content: string;
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
  // Guards against an earlier re-preview landing after a later one and
  // overwriting it with a stale sample.
  const requestId = useRef(0);

  // First pass: no mapping supplied, so the server infers one.
  useEffect(() => {
    let cancelled = false;
    api
      .previewStatement(accountId, content)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setMapping(result.mapping);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, content]);

  // Re-preview whenever the user edits the mapping. The supplied mapping means
  // the server skips inference, so this is a cheap parse, not another model call.
  function update(patch: Partial<StatementMapping>) {
    if (!mapping) return;
    const next = { ...mapping, ...patch };
    setMapping(next);
    const id = ++requestId.current;
    api
      .previewStatement(accountId, content, next)
      .then((result) => {
        if (id === requestId.current) setPreview(result);
      })
      .catch((e) => id === requestId.current && setError(e instanceof Error ? e.message : String(e)));
  }

  async function confirm() {
    if (!mapping) return;
    setImporting(true);
    setError(null);
    try {
      const result = await api.importStatement(accountId, content, mapping, applyLogo && !!preview?.detectedBank);
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

            <h3 style={{ marginBottom: "0.4rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>
              Preview
            </h3>
            {preview.sample.length === 0 ? (
              <p className="empty-state">
                No transactions read with this mapping — check the date column and format.
              </p>
            ) : (
              <div>
                {preview.sample.map((row, i) => (
                  <div className="tx-row" key={i}>
                    <div className="tx-row__info">
                      <div className="tx-row__name">{row.description || row.counterparty || "—"}</div>
                      <div className="tx-row__meta">
                        {row.date}
                        {row.counterparty && row.description ? ` · ${row.counterparty}` : ""}
                      </div>
                    </div>
                    <span className={`tx-row__amount${row.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
                      {row.amount >= 0 ? "+" : ""}
                      {row.amount.toFixed(2)} {preview.currency}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button onClick={onClose} disabled={importing}>
                Cancel
              </button>
              <button className="btn-accent" onClick={confirm} disabled={importing || preview.parsed === 0}>
                {importing ? <Loader2 size={14} className="spin" /> : null}
                Import {preview.parsed} transaction{preview.parsed === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
