import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Category, type Transaction } from "../api/client.js";
import { envelopePlan, type Assignments } from "../utils/envelope.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * Envelopes: money put into each category, with what is left carried forward.
 *
 * The standing budgets beside this answer "have I gone over this month" and
 * forget everything before. That suits a bill and suits nothing else — the
 * categories people struggle with are the lumpy ones, where the question is
 * "how much is there for this, now, given how the last few months went".
 *
 * An overspent envelope starts the next month negative rather than resetting.
 * That is the uncomfortable half and the honest one: resetting would let a
 * category be overspent every month forever while every individual month
 * looked survivable.
 */

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  let year = Number(month.slice(0, 4));
  let index = Number(month.slice(5, 7)) + by;
  while (index > 12) {
    index -= 12;
    year += 1;
  }
  while (index < 1) {
    index += 12;
    year -= 1;
  }
  return `${year}-${String(index).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function EnvelopeBudget({
  transactions,
  categories,
  currency,
}: {
  transactions: Transaction[];
  categories: Category[];
  currency: string | null;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<{ category_id: number; month: string; amount: number }[] | null>(null);
  const [draft, setDraft] = useState<{ categoryId: number; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAllocations()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const assignments: Assignments = useMemo(() => {
    const map: Assignments = new Map();
    for (const row of rows ?? []) {
      const forMonth = map.get(row.month) ?? new Map<number, number>();
      forMonth.set(row.category_id, row.amount);
      map.set(row.month, forMonth);
    }
    return map;
  }, [rows]);

  /**
   * Envelopes are for money going out.
   *
   * A category marked as regular income is where pay lands, and pay is what
   * fills the envelopes rather than being one — budgeting an amount "for"
   * your salary is not a thing anybody means. It also read badly: income in a
   * category makes its spending negative, so the row showed a refund of the
   * whole month's pay.
   */
  const spendingCategories = useMemo(() => categories.filter((c) => !c.counts_as_income), [categories]);

  const plan = useMemo(
    () => envelopePlan(transactions, assignments, spendingCategories, month),
    [transactions, assignments, spendingCategories, month]
  );

  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  async function save(categoryId: number, value: string) {
    const amount = Number(value.replace(/[,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("That isn't an amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setAllocation(categoryId, month, amount);
      setRows(await api.listAllocations());
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  }

  if (rows === null) return <p className="empty-state">Loading…</p>;
  if (categories.length === 0) return <p className="empty-state">Add a category first — an envelope needs something to be for.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <strong style={{ fontSize: "0.85rem", flex: 1, textAlign: "center" }}>{monthLabel(month)}</strong>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      {/* Zero-based budgeting's headline: what has not been given a job yet.
          Assigning more than came in is allowed — it may be funded by what
          was carried in — so it is reported rather than refused. */}
      <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <div>
          <p className="stat-tile__label">Came in</p>
          <p className="stat-tile__value" style={{ fontSize: "1rem" }}>{money(plan.income)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Given a job</p>
          <p className="stat-tile__value" style={{ fontSize: "1rem" }}>{money(plan.assigned)}</p>
        </div>
        <div>
          <p className="stat-tile__label">{plan.unassigned >= 0 ? "Still to assign" : "Over-assigned"}</p>
          <p
            className={`stat-tile__value${plan.unassigned >= 0 ? " stat-tile__value--good" : ""}`}
            style={{ fontSize: "1rem", color: plan.unassigned < 0 ? "var(--warning)" : undefined }}
          >
            {money(Math.abs(plan.unassigned))}
          </p>
        </div>
      </div>

      {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: "0 0 0.4rem" }}>{error}</p>}

      <div style={{ display: "grid", gap: "0.3rem", overflowY: "auto", minHeight: 0 }}>
        {plan.categories.map((row) => {
          const editing = draft?.categoryId === row.categoryId;
          return (
            <div
              key={row.categoryId}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", padding: "0.15rem 0" }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.label}
                {/* Where the envelope started the month, shown only when it
                    is not zero — otherwise every row carries a "· 0" that
                    says nothing. */}
                {row.carried !== 0 && (
                  <span style={{ color: row.carried < 0 ? "var(--warning)" : "var(--text-muted)", fontSize: "0.72rem" }}>
                    {" "}
                    · {row.carried < 0 ? "−" : "+"}
                    {money(Math.abs(row.carried))} carried
                  </span>
                )}
              </span>

              {editing ? (
                <input
                  autoFocus
                  value={draft.value}
                  onChange={(e) => setDraft({ categoryId: row.categoryId, value: e.target.value })}
                  onBlur={() => save(row.categoryId, draft.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") setDraft(null);
                  }}
                  style={{ width: 86, fontSize: "0.78rem", padding: "0.1rem 0.3rem" }}
                  aria-label={`Amount for ${row.label}`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setDraft({ categoryId: row.categoryId, value: String(row.assigned || "") })}
                  disabled={saving}
                  title={`Put money into ${row.label} for ${monthLabel(month)}`}
                  style={{ width: 86, fontSize: "0.78rem", padding: "0.1rem 0.3rem", background: "transparent", textAlign: "right" }}
                >
                  {saving ? <Loader2 size={11} className="spin" /> : money(row.assigned)}
                </button>
              )}

              {/* A category can be net positive for a month — more refunded
                  than spent — and a hard-coded minus turned that into
                  "−-€40.00". The sign follows the figure. */}
              <span style={{ width: 72, textAlign: "right", color: "var(--text-muted)", fontSize: "0.74rem" }}>
                {row.spent >= 0 ? "−" : "+"}
                {money(Math.abs(row.spent))}
              </span>

              <span
                style={{
                  width: 82,
                  textAlign: "right",
                  fontWeight: 600,
                  color: row.available < 0 ? "var(--critical)" : row.available > 0 ? "var(--good)" : "var(--text-muted)",
                }}
              >
                {money(row.available)}
              </span>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
        Put in · spent · left. What is left stays in the envelope next month, and an overspend carries against it.
      </p>
    </div>
  );
}
