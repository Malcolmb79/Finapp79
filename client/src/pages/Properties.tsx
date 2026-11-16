import { Home, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Property } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { useFxRates, toBase } from "../utils/fx.js";
import {
  countsAtValue,
  dscrVerdict,
  portfolioTotals,
  propertyContribution,
  propertyMetrics,
  PROPERTY_TYPES,
} from "../utils/propertyMetrics.js";

/**
 * Every door, and what each one is actually doing.
 *
 * A property is the largest thing most households own and the one this app
 * knew nothing about: it has no transactions, no IBAN and no bank connection,
 * so it was never going to arrive through a sync. Kept out of `accounts` for
 * exactly that reason — see the table in schema.sql.
 *
 * The metrics are deliberately the ones a lender or a landlord asks rather
 * than the ones that flatter. NOI before the mortgage, so the building is
 * judged separately from how it was financed. Coverage below 1 said out loud,
 * because a property that does not cover its own borrowing takes the shortfall
 * out of somebody's salary every month and the number alone does not say so.
 */

const BLANK: Partial<Property> = {
  address: "",
  property_type: "rental",
  currency: "EUR",
  vacancy_rate: 5,
  net_worth_source: "none",
};

const FIELDS: { key: keyof Property; label: string; hint?: string }[] = [
  { key: "market_value", label: "Worth now" },
  { key: "purchase_price", label: "Paid" },
  { key: "mortgage_balance", label: "Mortgage owed" },
  { key: "mortgage_payment", label: "Mortgage a month" },
  { key: "monthly_rent", label: "Rent a month", hint: "Gross, before vacancy" },
  { key: "monthly_expenses", label: "Costs a month", hint: "Rates, insurance, upkeep — not the mortgage" },
  { key: "vacancy_rate", label: "Vacancy %" },
];

export default function Properties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Property>>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const rates = useFxRates("EUR");

  const refresh = useCallback(() => {
    api
      .listProperties()
      .then(setProperties)
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const totals = portfolioTotals(properties);
  // Converted only for the headline, and only when every property shares a
  // currency would adding them raw be safe — which is exactly the mistake the
  // rest of the app refuses to make.
  const base = rates?.base ?? "EUR";
  const money = (value: number, currency = base) => formatCurrency(value, currency);

  const counted = properties.reduce((sum, property) => {
    const value = toBase(propertyContribution(property), property.currency, rates);
    return sum + (value ?? 0);
  }, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.address?.trim()) return;
    setError(null);
    try {
      await api.createProperty(draft);
      setDraft(BLANK);
      setAdding(false);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that property."));
    }
  }

  async function patch(id: string, body: Partial<Property>) {
    setError(null);
    try {
      await api.updateProperty(id, body);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that change."));
    }
  }

  async function remove(property: Property) {
    if (!window.confirm(`Remove ${property.address}? This cannot be undone.`)) return;
    await api.deleteProperty(property.id);
    refresh();
  }

  if (loading) return <p className="empty-state">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Property</h1>
          <p className="page-header__subtitle">Equity, yield and whether each one covers its own mortgage</p>
        </div>
        <button className="btn-accent" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} /> Add a property
        </button>
      </div>

      {error && <p style={{ color: "var(--critical)", fontSize: "0.8rem" }}>{error}</p>}

      {adding && (
        <form className="card" onSubmit={add} style={{ marginBottom: "1rem" }}>
          <div className="loan-form">
            <label style={{ gridColumn: "span 2" }}>
              <span>Address</span>
              <input
                autoFocus
                required
                value={draft.address ?? ""}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="123 Main Street, Dublin"
              />
            </label>
            <label>
              <span>Type</span>
              <select
                value={draft.property_type}
                onChange={(e) => setDraft({ ...draft, property_type: e.target.value as Property["property_type"] })}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Currency</span>
              <input
                value={draft.currency ?? "EUR"}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                maxLength={3}
              />
            </label>
            {FIELDS.map((field) => (
              <label key={String(field.key)} title={field.hint}>
                <span>{field.label}</span>
                <input
                  inputMode="decimal"
                  value={(draft[field.key] as number | null | undefined) ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [field.key]: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem" }}>
            <button type="submit" className="btn-accent">
              Save property
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {properties.length === 0 ? (
        <p className="empty-state">
          No property yet. A house is usually the largest thing a household owns and the one thing no bank feed will ever
          send you — it has to be entered by hand.
        </p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="stat-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))" }}>
              <div>
                <p className="stat-tile__label">Portfolio value</p>
                <p className="stat-tile__value">{money(totals.value)}</p>
              </div>
              <div>
                <p className="stat-tile__label">Mortgages</p>
                <p className="stat-tile__value" style={{ color: "var(--critical)" }}>
                  {money(totals.mortgages)}
                </p>
              </div>
              <div>
                <p className="stat-tile__label">Equity</p>
                <p className="stat-tile__value" style={{ color: "var(--good)" }}>
                  {money(totals.equity)}
                </p>
              </div>
              <div>
                <p className="stat-tile__label">Rent a month</p>
                <p className="stat-tile__value">{money(totals.monthlyRent)}</p>
              </div>
              <div>
                <p className="stat-tile__label">NOI a month</p>
                <p className="stat-tile__value">{money(totals.monthlyNoi)}</p>
              </div>
              <div>
                <p className="stat-tile__label">After mortgages</p>
                <p className="stat-tile__value" style={{ color: totals.monthlyCashFlow < 0 ? "var(--critical)" : "var(--good)" }}>
                  {money(totals.monthlyCashFlow)}
                </p>
              </div>
            </div>
            <ul className="report__notes" style={{ marginTop: "0.6rem" }}>
              {/* The totals are sums of the figures that exist. Saying how many
                  were left out keeps an unfinished portfolio from reading as a
                  bad one. */}
              {totals.incomplete > 0 && (
                <li>
                  {totals.incomplete} propert{totals.incomplete === 1 ? "y has" : "ies have"} no value recorded, so{" "}
                  {totals.incomplete === 1 ? "it is" : "they are"} not in these totals.
                </li>
              )}
              <li>
                NOI is rent after vacancy and running costs, <strong>before</strong> the mortgage — what the building earns,
                separately from how it was financed.
              </li>
              <li>
                {counted === 0
                  ? "None of these count towards your net worth yet. Choose a figure on a property below to include it."
                  : `${money(counted)} of this is in your net worth.`}
              </li>
            </ul>
          </div>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            {properties.map((property) => {
              const metrics = propertyMetrics(property);
              const verdict = dscrVerdict(metrics.dscr, property);
              const inMoney = (value: number | null) => (value === null ? "—" : money(value, property.currency));
              return (
                <div className="card" key={property.id}>
                  <div className="card__header" style={{ marginBottom: "0.6rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                      <Home size={15} style={{ color: "var(--accent-2)", flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: "0.92rem" }}>{property.address}</strong>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
                          {PROPERTY_TYPES.find((t) => t.value === property.property_type)?.label} · {property.currency}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => remove(property)} title="Remove this property" className="card__icon-button">
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="property-metrics">
                    <div>
                      <span>Value</span>
                      <strong>{inMoney(property.market_value)}</strong>
                    </div>
                    <div>
                      <span>Mortgage</span>
                      <strong>{inMoney(property.mortgage_balance ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Equity</span>
                      <strong style={{ color: "var(--good)" }}>{inMoney(metrics.equity)}</strong>
                    </div>
                    <div>
                      <span>NOI / month</span>
                      <strong>{inMoney(metrics.noi)}</strong>
                    </div>
                    <div>
                      <span>Cap rate</span>
                      <strong>{metrics.capRate === null ? "—" : `${metrics.capRate.toFixed(1)}%`}</strong>
                    </div>
                    <div>
                      <span>DSCR</span>
                      <strong style={{ color: verdict.tone === "bad" ? "var(--critical)" : undefined }}>
                        {metrics.dscr === null ? "—" : metrics.dscr.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <span>After mortgage</span>
                      <strong style={{ color: (metrics.cashFlow ?? 0) < 0 ? "var(--critical)" : "var(--good)" }}>
                        {inMoney(metrics.cashFlow)}
                      </strong>
                    </div>
                  </div>

                  <p
                    style={{
                      fontSize: "0.76rem",
                      margin: "0.5rem 0 0",
                      color: verdict.tone === "bad" ? "var(--critical)" : verdict.tone === "muted" ? "var(--text-muted)" : undefined,
                    }}
                  >
                    {verdict.label}
                    {verdict.tone === "bad" && metrics.cashFlow !== null && (
                      <> — {money(Math.abs(metrics.cashFlow), property.currency)} a month comes from somewhere else.</>
                    )}
                  </p>

                  {/* The decision, named rather than assumed, exactly as a
                      policy's is. */}
                  <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}>
                    <span style={{ color: "var(--text-muted)" }}>In net worth as</span>
                    <select
                      value={property.net_worth_source}
                      onChange={(e) => patch(property.id, { net_worth_source: e.target.value as Property["net_worth_source"] })}
                      style={{ fontSize: "0.75rem", padding: "0.1rem 0.3rem" }}
                    >
                      <option value="none">Not counted</option>
                      <option value="equity">Equity (value less mortgage)</option>
                      <option value="value">Full value (mortgage tracked elsewhere)</option>
                    </select>
                    {countsAtValue(property) && (
                      <em style={{ color: "var(--warning)", fontStyle: "normal" }}>
                        Make sure this mortgage is a loan account, or the debt is missing from your net worth.
                      </em>
                    )}
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
