import { Link } from "react-router-dom";
import { formatCurrency } from "../utils/formatCurrency.js";
import { creditHealth, GOOD_UTILISATION, utilisationNote, utilisationTone } from "../utils/creditHealth.js";
import { toBase } from "../utils/fx.js";
import type { Account, FxRates } from "../api/client.js";

/**
 * How much of the available credit is in use.
 *
 * The one input to a credit file that moves fastest and is almost entirely
 * under the holder's control — recalculated every statement, unlike a payment
 * history that takes years to repair. It is also the one nobody can see
 * without doing the division, because a card shows its balance and its limit
 * on different screens.
 *
 * Each card gets its own line as well as the total, because lenders read them
 * individually: one card at ninety-five per cent drags a file down while the
 * overall figure still looks respectable. And every strained line names the
 * amount that would fix it, since a percentage is a diagnosis and a figure is
 * something somebody can do this afternoon.
 *
 * This is not a credit score and does not pretend to be one. A score needs the
 * file itself, which this app has no access to.
 */

export interface CreditHealthProps {
  accounts: Account[];
  /** Signed, in each account's own currency. Negative is owed. */
  balances: Map<string, number>;
  rates: FxRates | null;
}

export default function CreditHealthCard({ accounts, balances, rates }: CreditHealthProps) {
  const currency = rates?.base ?? "EUR";
  // Each card's percentage is a ratio within one currency and needs nothing;
  // the totals add across cards, which does.
  const health = creditHealth(accounts, balances, (amount, from) => toBase(amount, from, rates));
  const money = (value: number) => formatCurrency(value, currency);
  const inOwn = (card: { account: Account }, value: number) => formatCurrency(value, card.account.currency);

  if (health.cards.length === 0) {
    return (
      <p className="empty-state">
        No cards or arranged overdrafts here. Utilisation only means something on credit you can draw and repay at will —
        a loan has no limit to use a share of.
      </p>
    );
  }

  const overallTone = utilisationTone(health.overall);

  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(7.5rem, 1fr))", marginBottom: "0.8rem" }}>
        <div>
          <p className="stat-tile__label">Credit in use</p>
          <p
            className="stat-tile__value"
            style={{
              color:
                overallTone === "critical" ? "var(--critical)" : overallTone === "warning" ? "var(--warning)" : "var(--good)",
            }}
          >
            {health.overall === null ? "—" : `${(health.overall * 100).toFixed(0)}%`}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">Owed</p>
          <p className="stat-tile__value">{money(health.totalDrawn)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Total limit</p>
          <p className="stat-tile__value">{money(health.totalLimit)}</p>
        </div>
        <div>
          <p className="stat-tile__label">Still available</p>
          <p className="stat-tile__value">{money(Math.max(0, health.totalLimit - health.totalDrawn))}</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.55rem" }}>
        {health.cards.map((card) => {
          const tone = utilisationTone(card.utilisation);
          const pct = card.utilisation === null ? 0 : Math.min(100, card.utilisation * 100);
          return (
            <div key={card.account.id}>
              <div className="budget-row__meta">
                <span style={{ fontSize: "0.84rem" }}>{card.account.name}</span>
                <span className="budget-row__amounts">
                  {card.utilisation === null ? (
                    <em style={{ color: "var(--text-muted)", fontStyle: "normal", fontSize: "0.78rem" }}>no limit set</em>
                  ) : (
                    <>
                      {inOwn(card, card.drawn)} / {inOwn(card, card.limit)} ·{" "}
                      <strong
                        style={{
                          color:
                            tone === "critical" ? "var(--critical)" : tone === "warning" ? "var(--warning)" : "var(--good)",
                        }}
                      >
                        {(card.utilisation * 100).toFixed(0)}%
                      </strong>
                    </>
                  )}
                </span>
              </div>
              <div className="budget-row__track">
                <div
                  className="budget-row__fill"
                  data-status={tone === "critical" ? "critical" : tone === "warning" ? "warning" : "good"}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0.15rem 0 0", lineHeight: 1.4 }}>
                {utilisationNote(card, (value) => inOwn(card, value))}
              </p>
            </div>
          );
        })}
      </div>

      <ul className="report__notes" style={{ marginTop: "0.8rem" }}>
        {health.unknownLimits > 0 && (
          <li>
            {health.unknownLimits} card{health.unknownLimits === 1 ? " has" : "s have"} no credit limit recorded, so{" "}
            {health.unknownLimits === 1 ? "it is" : "they are"} not in the total.{" "}
            <Link to="/accounts">Add the limit on Accounts</Link> to include {health.unknownLimits === 1 ? "it" : "them"}.
          </li>
        )}
        <li>
          Lenders read each card on its own as well as the total, so one card above{" "}
          {(GOOD_UTILISATION * 100).toFixed(0)}% matters even when the overall figure looks fine.
        </li>
        <li>
          What gets reported is usually the statement balance, not what is left after you pay it — so clearing in full each
          month can still report high usage if the statement is cut while the card is loaded.
        </li>
        <li>This is not a credit score. A score needs your actual file, which this app cannot see.</li>
      </ul>
    </>
  );
}
