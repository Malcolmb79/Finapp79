import { TrendingUp } from "lucide-react";
import { formatCurrency } from "../../utils/formatCurrency.js";
import type { PriceRise } from "../../utils/priceRises.js";

/**
 * Subscriptions that went up, and what the rise costs over a year.
 *
 * The annual figure is the whole reason this exists. "Netflix went up £3" is
 * a shrug; "£36 a year" is a phone call. The paid apps sell the phone call
 * itself as a service — a person haggles with your provider for a cut of the
 * saving — and that is a call centre, not software. This is the part software
 * can do: notice, and make the size of it plain.
 */
export default function PriceRises({ rises, currency }: { rises: PriceRise[]; currency: string | null }) {
  const money = (value: number) => (currency ? formatCurrency(value, currency) : value.toFixed(2));

  if (rises.length === 0) {
    return (
      <p className="empty-state">
        Nothing has gone up. A rise shows here once a charge has settled at one price for three billing cycles and then
        changed.
      </p>
    );
  }

  const annualTotal = rises.reduce((sum, rise) => sum + rise.annualIncrease, 0);

  return (
    <div>
      <div style={{ marginBottom: "0.8rem" }}>
        <p className="stat-tile__label">Increases, over a year</p>
        <p className="stat-tile__value" style={{ color: "var(--critical)" }}>
          {money(annualTotal)}
        </p>
      </div>

      <div style={{ display: "grid", gap: "0.1rem" }}>
        {rises.map((rise) => (
          <div key={rise.key} className="tx-row" style={{ cursor: "default" }}>
            <div className="tx-row__icon">
              <TrendingUp size={15} color="var(--critical)" />
            </div>
            <div className="tx-row__info">
              <div className="tx-row__name">{rise.label}</div>
              <div className="tx-row__meta">
                {money(rise.was)} → {money(rise.now)} · up {(rise.fraction * 100).toFixed(0)}% since {rise.since}
              </div>
            </div>
            <span className="tx-row__amount" style={{ color: "var(--critical)" }}>
              +{money(rise.annualIncrease)}/yr
            </span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.6rem 0 0" }}>
        Worth a call: most providers will discount rather than lose an account that asks.
      </p>
    </div>
  );
}
