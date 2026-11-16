import { AlertTriangle, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCoachContext } from "../contexts/CoachContext.js";
import { api, type BtlDeal } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { appraiseDeal, BLANK_DEAL, DEFAULT_ICR, type DealInput, type DealResult } from "../utils/btlDeal.js";
import { IRISH_RATES_YEAR } from "../utils/irishTax.js";

/**
 * Buy-to-let deals, appraised before they are bought.
 *
 * Built from a UK landlord's deal sheet and corrected for Ireland, which is
 * most of the work: there is no second-home stamp duty surcharge here, no
 * Section 24 add-back, USC and PRSI sit on top of income tax, Local Property
 * Tax falls on the owner rather than the tenant, and a close company pays
 * roughly forty per cent on rent it retains. The UK sheet's usual conclusion —
 * buy it through a limited company — frequently reverses on this side of the
 * water.
 *
 * Laid out the way the spreadsheet it replaces is: a column per deal and a row
 * per figure, because the whole point is comparing three candidates at a
 * glance rather than opening three of anything.
 */

const PCT = (value: number | null, places = 1) => (value === null ? "—" : `${(value * 100).toFixed(places)}%`);

/** The deal as the calculator wants it, out of the row as the database stores it. */
function toInput(deal: BtlDeal): DealInput {
  return {
    name: deal.name,
    purchasePrice: deal.purchase_price,
    ltv: deal.ltv,
    mortgageRate: deal.mortgage_rate,
    interestOnly: deal.interest_only,
    termYears: deal.term_years,
    arrangementFees: deal.arrangement_fees,
    purchaseFees: deal.purchase_fees,
    apartmentBlock: deal.apartment_block,
    bulkPurchase: deal.bulk_purchase,
    refurbCost: deal.refurb_cost,
    valueAfterWorks: deal.value_after_works || deal.purchase_price,
    furnishingsCost: deal.furnishings_cost,
    units: deal.units,
    rentPerUnit: deal.rent_per_unit,
    vacancyRate: deal.vacancy_rate,
    managementRate: deal.management_rate,
    lptAnnual: deal.lpt_annual,
    insuranceMonthly: deal.insurance_monthly,
    maintenanceMonthly: deal.maintenance_monthly,
    serviceChargeMonthly: deal.service_charge_monthly,
    rtbFeeAnnual: deal.rtb_fee_annual,
    otherMonthly: deal.other_monthly,
    ownership: deal.ownership,
    marginalRate: deal.marginal_rate,
    retainedShare: deal.retained_share,
    rtbRegistered: deal.rtb_registered,
  };
}

/** A fresh deal as the API wants it, from the worked defaults. */
function blankRow(name: string): Partial<BtlDeal> {
  const d = BLANK_DEAL;
  return {
    name,
    currency: "EUR",
    purchase_price: d.purchasePrice,
    ltv: d.ltv,
    mortgage_rate: d.mortgageRate,
    interest_only: d.interestOnly,
    term_years: d.termYears,
    arrangement_fees: d.arrangementFees,
    purchase_fees: d.purchaseFees,
    apartment_block: false,
    bulk_purchase: false,
    refurb_cost: d.refurbCost,
    value_after_works: d.valueAfterWorks,
    furnishings_cost: d.furnishingsCost,
    units: d.units,
    rent_per_unit: d.rentPerUnit,
    vacancy_rate: d.vacancyRate,
    management_rate: d.managementRate,
    lpt_annual: d.lptAnnual,
    insurance_monthly: d.insuranceMonthly,
    maintenance_monthly: d.maintenanceMonthly,
    service_charge_monthly: d.serviceChargeMonthly,
    rtb_fee_annual: d.rtbFeeAnnual,
    other_monthly: d.otherMonthly,
    ownership: d.ownership,
    marginal_rate: d.marginalRate,
    retained_share: d.retainedShare,
    rtb_registered: d.rtbRegistered,
  };
}

/** Every editable figure, grouped the way somebody fills a deal sheet in. */
const FIELDS: { group: string; items: { key: keyof BtlDeal; label: string; hint?: string; kind?: "pct" | "bool" }[] }[] = [
  {
    group: "Purchase",
    items: [
      { key: "purchase_price", label: "Purchase price" },
      { key: "ltv", label: "LTV", kind: "pct", hint: "Irish BTL lenders rarely go past 70%" },
      { key: "mortgage_rate", label: "Rate %" },
      { key: "term_years", label: "Term, years" },
      { key: "interest_only", label: "Interest only", kind: "bool", hint: "Rare in Ireland — most BTL is capital & interest" },
      { key: "arrangement_fees", label: "Arrangement fees", hint: "Added to the loan" },
      { key: "purchase_fees", label: "Legal & survey", hint: "Paid up front, never added to the loan" },
      { key: "apartment_block", label: "3+ apartments, one block", kind: "bool", hint: "Stamp duty stops at 2%" },
      { key: "bulk_purchase", label: "10+ units in 12 months", kind: "bool", hint: "15% stamp duty on the whole price" },
    ],
  },
  {
    group: "Works & value",
    items: [
      { key: "refurb_cost", label: "Refurbishment" },
      { key: "value_after_works", label: "Worth after works" },
      { key: "furnishings_cost", label: "Furniture & fittings", hint: "Wear and tear at 12.5% a year over eight" },
    ],
  },
  {
    group: "Income",
    items: [
      { key: "units", label: "Lettable units" },
      { key: "rent_per_unit", label: "Rent per unit, monthly" },
      { key: "vacancy_rate", label: "Vacancy %" },
    ],
  },
  {
    group: "Running costs",
    items: [
      { key: "management_rate", label: "Management %", hint: "23% VAT is added on top" },
      { key: "lpt_annual", label: "LPT, annual", hint: "The owner's in Ireland, unlike UK council tax" },
      { key: "service_charge_monthly", label: "Service charge, monthly" },
      { key: "insurance_monthly", label: "Insurance, monthly" },
      { key: "maintenance_monthly", label: "Maintenance, monthly" },
      { key: "rtb_fee_annual", label: "RTB fee, annual", hint: "Per tenancy" },
      { key: "other_monthly", label: "Other, monthly" },
    ],
  },
  {
    group: "Tax",
    items: [
      { key: "marginal_rate", label: "Your tax band", kind: "pct", hint: "20 or 40 — the band this profit lands in" },
      { key: "retained_share", label: "Left in company %", kind: "pct", hint: "Only matters if owned through a company" },
      { key: "rtb_registered", label: "Tenancy RTB registered", kind: "bool", hint: "Interest relief depends on it" },
    ],
  },
];

/** The rows of the comparison, each one pulling a figure out of an appraisal. */
const ROWS: { label: string; hint?: string; get: (r: DealResult, money: (v: number) => string) => string; tone?: (r: DealResult) => string | undefined }[] = [
  { label: "Stamp duty", get: (r, m) => m(r.stamp.total) },
  { label: "Deposit", get: (r, m) => m(r.deposit) },
  { label: "Cash needed", hint: "Deposit, fees, stamp duty, refurb and furnishings", get: (r, m) => m(r.cashRequired) },
  { label: "Mortgage, monthly", get: (r, m) => m(r.monthlyMortgage) },
  { label: "Rent after vacancy", get: (r, m) => m(r.effectiveMonthlyRent) },
  { label: "Running costs", get: (r, m) => m(r.totalMonthlyCosts) },
  {
    label: "Cash flow, monthly",
    get: (r, m) => m(r.monthlyCashFlow),
    tone: (r) => (r.monthlyCashFlow < 0 ? "var(--critical)" : "var(--good)"),
  },
  {
    label: "Taxable profit, annual",
    hint: "Not cash flow — capital repaid comes back on, wear and tear comes off",
    get: (r, m) => m(r.taxableProfit),
  },
  { label: "Tax", get: (r, m) => m(r.tax.total) },
  {
    label: "After tax, monthly",
    get: (r, m) => m(r.monthlyAfterTax),
    tone: (r) => (r.monthlyAfterTax < 0 ? "var(--critical)" : "var(--good)"),
  },
  { label: "Gross yield", get: (r) => PCT(r.grossYield) },
  { label: "Cash-on-cash", hint: "Annual cash flow over the money actually put in", get: (r) => PCT(r.cashOnCash) },
  {
    label: "Lender cover",
    hint: `Rent over the mortgage stressed 2 points higher. ${DEFAULT_ICR}× or better`,
    get: (r) => (r.icr.cover === null ? "—" : `${r.icr.cover.toFixed(2)}×`),
    tone: (r) => (r.icr.passes ? "var(--good)" : "var(--critical)"),
  },
  { label: "Equity after works", get: (r, m) => m(r.equityAfterRefurb) },
  { label: "LTV after works", get: (r) => PCT(r.newLtv) },
  { label: "Per €100k, after tax", hint: "For comparing deals of different sizes", get: (r, m) => (r.perHundredThousand === null ? "—" : m(r.perHundredThousand)) },
];

export default function BuyToLet() {
  const [deals, setDeals] = useState<BtlDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .listBtlDeals()
      .then(setDeals)
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const money = (value: number, currency = "EUR") => formatCurrency(value, currency);
  const appraised = useMemo(() => deals.map((deal) => ({ deal, result: appraiseDeal(toInput(deal)) })), [deals]);

  /**
   * Hands the appraised deals to the coach.
   *
   * The only page that does this, and only because a deal is nowhere in the
   * database as an appraisal — it is a set of assumptions worked through in
   * the browser, kept out of `properties` on purpose so that things nobody
   * has bought stay out of net worth. Everything else the coach needs it
   * looks up itself from the real rows; see contexts/CoachContext.tsx for why
   * that distinction is kept rather than blurred.
   */
  const { setContext } = useCoachContext();
  useEffect(() => {
    if (appraised.length === 0) {
      setContext(undefined);
      return;
    }
    const lines = appraised.map(({ deal, result }) =>
      [
        `Deal "${deal.name}": price ${deal.purchase_price}, rent ${deal.rent_per_unit} per unit across ${deal.units},`,
        `${deal.ltv}% LTV at ${deal.mortgage_rate}% over ${deal.term_years}y${deal.interest_only ? ", interest only" : ""}.`,
        `Cash needed ${result.cashRequired}. Cash flow ${result.monthlyCashFlow}/mo before tax,`,
        `${result.monthlyAfterTax}/mo after. Gross yield ${result.grossYield ?? "n/a"},`,
        `net ${result.netYield ?? "n/a"}, cash-on-cash ${result.cashOnCash ?? "n/a"}.`,
        `Stamp duty ${result.stamp.total}. Lender ICR cover ${result.icr.cover ?? "n/a"}`,
        `(${result.icr.passes ? "passes" : "fails"}).`,
        `Held personally: ${result.personal.total} tax a year. Through a company: ${result.company.total}.`,
        result.warnings.length > 0 ? `Warnings: ${result.warnings.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
    setContext(lines.join("\n"));
    return () => setContext(undefined);
  }, [appraised, setContext]);

  async function add(from?: BtlDeal) {
    setError(null);
    try {
      const body = from
        ? { ...blankRow(`${from.name} (copy)`), ...Object.fromEntries(Object.entries(from).filter(([k]) => !["id", "created_at", "name"].includes(k))), name: `${from.name} (copy)` }
        : blankRow(`Deal ${deals.length + 1}`);
      const created = await api.createBtlDeal(body);
      setOpen(created.id);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create that deal."));
    }
  }

  async function patch(id: string, body: Partial<BtlDeal>) {
    // Optimistic, because every keystroke in a field re-runs the appraisal and
    // waiting on a round trip for each one would make the figures lag the
    // typing by a noticeable beat.
    setDeals((current) => current.map((d) => (d.id === id ? { ...d, ...body } : d)));
    try {
      await api.updateBtlDeal(id, body);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that change."));
      refresh();
    }
  }

  async function remove(deal: BtlDeal) {
    if (!window.confirm(`Remove ${deal.name}? This cannot be undone.`)) return;
    await api.deleteBtlDeal(deal.id);
    refresh();
  }

  if (loading) return <p className="empty-state">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Buy to Let</h1>
          <p className="page-header__subtitle">Appraise a deal before you buy it · Irish rules, {IRISH_RATES_YEAR} rates</p>
        </div>
        <button className="btn-accent" onClick={() => add()}>
          <Plus size={14} /> Add a deal
        </button>
      </div>

      {error && <p style={{ color: "var(--critical)", fontSize: "0.8rem" }}>{error}</p>}

      {deals.length === 0 ? (
        <div className="card">
          <p className="empty-state" style={{ marginBottom: "0.8rem" }}>
            No deals yet. Add one and it opens on a worked example you can edit — €300,000 at 70% over 25 years, letting
            at €1,800 a month.
          </p>
          <IrishNotes />
        </div>
      ) : (
        <>
          {/* The spreadsheet's layout, because the whole value of a deal sheet
              is three candidates side by side rather than three of anything
              opened one at a time. */}
          <div className="card btl-compare">
            <table className="report__table">
              <thead>
                <tr>
                  <th>Figure</th>
                  {appraised.map(({ deal }) => (
                    <th key={deal.id} style={{ textAlign: "right" }}>
                      {deal.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td>
                      {row.label}
                      {row.hint && <span className="report__detail">{row.hint}</span>}
                    </td>
                    {appraised.map(({ deal, result }) => (
                      <td
                        key={deal.id}
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: row.tone?.(result) }}
                      >
                        {row.get(result, (v) => money(v, deal.currency))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
            {appraised.map(({ deal, result }) => (
              <div className="card" key={deal.id}>
                <div className="card__header" style={{ marginBottom: "0.5rem" }}>
                  <input
                    value={deal.name}
                    onChange={(e) => patch(deal.id, { name: e.target.value })}
                    aria-label="Deal name"
                    style={{ fontWeight: 600, fontSize: "0.95rem", border: "none", background: "transparent", minWidth: 0 }}
                  />
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button className="card__icon-button" onClick={() => add(deal)} title="Model a variation of this deal">
                      <Copy size={13} />
                    </button>
                    <button className="card__icon-button" onClick={() => remove(deal)} title="Remove this deal">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <TaxComparison result={result} deal={deal} onChange={(body) => patch(deal.id, body)} money={(v) => money(v, deal.currency)} />

                {result.warnings.length > 0 && (
                  <ul className="btl-warnings">
                    {result.warnings.map((warning) => (
                      <li key={warning}>
                        <AlertTriangle size={12} /> {warning}
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  className="btl-toggle"
                  onClick={() => setOpen((current) => (current === deal.id ? null : deal.id))}
                >
                  {open === deal.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {open === deal.id ? "Hide the figures" : "Edit the figures"}
                </button>

                {open === deal.id && (
                  <div className="btl-fields">
                    {FIELDS.map((group) => (
                      <fieldset key={group.group}>
                        <legend>{group.group}</legend>
                        {group.items.map((field) => {
                          const raw = deal[field.key];
                          if (field.kind === "bool") {
                            return (
                              <label key={String(field.key)} className="btl-check" title={field.hint}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(raw)}
                                  onChange={(e) => patch(deal.id, { [field.key]: e.target.checked } as Partial<BtlDeal>)}
                                />
                                <span>{field.label}</span>
                              </label>
                            );
                          }
                          // Fractions are stored 0–1 and shown 0–100, because
                          // nobody writes an LTV as 0.7.
                          const shown = field.kind === "pct" ? Math.round(Number(raw) * 100) : (raw as number);
                          return (
                            <label key={String(field.key)} title={field.hint}>
                              <span>{field.label}</span>
                              <input
                                inputMode="decimal"
                                value={String(shown ?? "")}
                                onChange={(e) => {
                                  const parsed = Number(e.target.value.replace(/[,\s]/g, ""));
                                  if (!Number.isFinite(parsed)) return;
                                  patch(deal.id, {
                                    [field.key]: field.kind === "pct" ? parsed / 100 : parsed,
                                  } as Partial<BtlDeal>);
                                }}
                              />
                            </label>
                          );
                        })}
                      </fieldset>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <IrishNotes />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The two ownership routes side by side, which is the question the UK sheet
 * answers one way and Ireland answers another.
 */
function TaxComparison({
  result,
  deal,
  onChange,
  money,
}: {
  result: DealResult;
  deal: BtlDeal;
  onChange: (body: Partial<BtlDeal>) => void;
  money: (value: number) => string;
}) {
  const better = result.personal.total <= result.company.total ? "personal" : "company";
  const gap = Math.abs(result.personal.total - result.company.total);

  return (
    <>
      <div className="btl-tax">
        {(["personal", "company"] as const).map((route) => {
          const tax = route === "personal" ? result.personal : result.company;
          const chosen = deal.ownership === route;
          return (
            <button
              key={route}
              onClick={() => onChange({ ownership: route })}
              className="btl-route"
              data-chosen={chosen ? "true" : undefined}
              data-better={better === route ? "true" : undefined}
            >
              <strong>{route === "personal" ? "In your own name" : "Through a company"}</strong>
              <span className="btl-route__figure">{money(tax.total)}</span>
              <span className="btl-route__detail">
                {route === "personal"
                  ? `Income tax, USC and PRSI · ${(result.personal.effectiveRate * 100).toFixed(1)}% of profit`
                  : `25% corporation tax${result.company.surcharge > 0 ? " + 20% surcharge on what stays in" : ""} · ${(result.company.effectiveRate * 100).toFixed(1)}%`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="btl-verdict">
        {gap < 1 ? (
          "The two routes cost the same on these figures."
        ) : (
          <>
            {better === "personal" ? "Your own name" : "A company"} is {money(gap)} a year cheaper here
            {better === "personal" && result.company.surcharge > 0
              ? " — the close company surcharge on retained rent is what tips it."
              : better === "company"
                ? " — but a company has filing costs, and getting the money out is taxed again."
                : "."}
          </>
        )}
      </p>
    </>
  );
}

/** What changes between a UK deal sheet and an Irish one, said once. */
function IrishNotes() {
  return (
    <>
      <strong style={{ fontSize: "0.8rem" }}>What&apos;s different here</strong>
      <ul className="report__notes" style={{ marginTop: "0.4rem" }}>
        <li>
          <strong>No second-home stamp duty surcharge.</strong> A landlord pays the same 1% / 2% / 6% bands as an owner
          occupier. A UK sheet adds its surcharge and overstates the entry cost by more than the duty itself.
        </li>
        <li>
          <strong>No Section 24.</strong> Mortgage interest is 100% deductible against rental profit, so a UK sheet&apos;s
          add-back overstates the tax on every geared deal.
        </li>
        <li>
          <strong>But the deduction hangs on the RTB.</strong> An unregistered tenancy loses the whole year&apos;s interest
          on that property — not a reduction, a cliff edge.
        </li>
        <li>
          <strong>USC and PRSI sit on top of income tax.</strong> A higher-rate landlord is at roughly 52% on rental
          profit, against the UK&apos;s 40%.
        </li>
        <li>
          <strong>A company is usually worse, not better.</strong> Rental profit is charged at 25%, and a close company
          retaining it pays a further 20% on what&apos;s left — about 40% all in. Taking it out is taxed again at your
          own rate.
        </li>
        <li>
          <strong>Local Property Tax is the owner&apos;s.</strong> UK council tax is usually the tenant&apos;s, so a UK
          sheet has no line for it at all.
        </li>
        <li>
          Figures are planning arithmetic on {IRISH_RATES_YEAR} rates, not tax advice. Rent Pressure Zone caps on
          increases are not modelled — check whether the address is in one.
        </li>
      </ul>
    </>
  );
}
