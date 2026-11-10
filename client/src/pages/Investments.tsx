import { Coins, Loader2, PieChart, Plus, Trash2, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Holding, type HoldingKind } from "../api/client.js";
import DonutChart from "../components/dashboard/DonutChart.js";
import StatTile from "../components/dashboard/StatTile.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useRefresh } from "../contexts/RefreshContext.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { sumInBase, useFxRates } from "../utils/fx.js";
import { holdingCost, holdingGain, holdingValue, latestPrice } from "../utils/holdingValue.js";

const KINDS: { value: HoldingKind; label: string }[] = [
  { value: "equity", label: "Shares" },
  { value: "fund", label: "Fund or ETF" },
  { value: "bond", label: "Bond" },
  { value: "crypto", label: "Crypto" },
  { value: "other", label: "Other" },
];

const WIDGETS = [
  { id: "summary", defaultWidth: 672, defaultHeight: 200 },
  { id: "allocation", defaultWidth: 328, defaultHeight: 320 },
  { id: "add", defaultWidth: 328, defaultHeight: 320 },
  { id: "holdings", defaultWidth: 672, defaultHeight: 420 },
];

/**
 * What is held, what it cost, and what it is worth now.
 *
 * Deliberately not a brokerage: there is no price feed, no order history and
 * no performance attribution. Prices are entered, the same contract as every
 * other figure in this app — nothing is recorded that its owner has not seen.
 *
 * Every price is kept rather than overwritten, which is what lets a holding
 * appear in the net worth trend from its first price onward instead of
 * projecting today's figure back across months it was worth something else.
 */
export default function Investments() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rates = useFxRates("EUR");
  const { refresh: signalWritten } = useRefresh();

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState<HoldingKind>("equity");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");

  const load = useCallback(() => {
    api.listHoldings().then(setHoldings).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const refresh = useCallback(() => {
    load();
    signalWritten();
  }, [load, signalWritten]);

  const number = (value: string): number | null => {
    const trimmed = value.trim().replace(/[,\s]/g, "");
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const qty = number(quantity);
    if (!name.trim() || qty === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.createHolding({
        name: name.trim(),
        ticker: ticker.trim() || null,
        kind,
        quantity: qty,
        unit_cost: number(unitCost),
        currency: currency.trim().toUpperCase() || "EUR",
        ...(number(unitPrice) !== null ? { unit_price: number(unitPrice)! } : {}),
      });
      setName("");
      setTicker("");
      setQuantity("");
      setUnitCost("");
      setUnitPrice("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that holding.");
    } finally {
      setBusy(false);
    }
  }

  const { converted: totalValue, unconvertible } = sumInBase(
    holdings
      .map((h) => ({ amount: holdingValue(h), currency: h.currency }))
      .filter((e): e is { amount: number; currency: string } => e.amount !== null),
    rates
  );
  const { converted: totalCost } = sumInBase(
    holdings
      .map((h) => ({ amount: holdingCost(h), currency: h.currency }))
      .filter((e): e is { amount: number; currency: string } => e.amount !== null),
    rates
  );
  const gain = totalValue - totalCost;
  const base = rates?.base ?? "EUR";
  // Only holdings with a cost basis can say anything about gain, so the
  // percentage is computed over those alone rather than over everything.
  const gainFraction = totalCost > 0 ? gain / totalCost : null;
  const unpriced = holdings.filter((h) => latestPrice(h) === null);

  const bodies: Record<string, { title: string; icon: typeof Coins; accentVar: string; body: React.ReactNode }> = {
    summary: {
      title: "Portfolio",
      icon: TrendingUp,
      accentVar: "--accent",
      body:
        holdings.length === 0 ? (
          <p className="empty-state">Nothing held yet. Add a holding to see it here and in net worth.</p>
        ) : (
          <>
            <div className="stat-row">
              <StatTile label="Value" value={formatCurrency(totalValue, base)} />
              <StatTile label="Cost" value={totalCost > 0 ? formatCurrency(totalCost, base) : "—"} />
              <div>
                <p className="stat-tile__label">Gain</p>
                <p className={`stat-tile__value${gain >= 0 ? " stat-tile__value--good" : ""}`}>
                  {totalCost > 0 ? `${gain >= 0 ? "+" : ""}${formatCurrency(gain, base)}` : "—"}
                  {gainFraction !== null && (
                    <span style={{ fontSize: "0.8rem", fontWeight: 400 }}> ({(gainFraction * 100).toFixed(1)}%)</span>
                  )}
                </p>
              </div>
            </div>
            {/* An unpriced holding is unknown, not worthless — counting it as
                zero would quietly drag the total down by the whole of it, so
                it is left out and said out loud instead. */}
            {unpriced.length > 0 && (
              <p style={{ fontSize: "0.75rem", color: "var(--critical)", margin: "0.5rem 0 0" }}>
                {unpriced.length} holding{unpriced.length === 1 ? " has" : "s have"} no price yet, so {unpriced.length === 1 ? "it is" : "they are"} left
                out of these totals.
              </p>
            )}
            {unconvertible.length > 0 && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
                Left out — no exchange rate for {unconvertible.join(", ")}.
              </p>
            )}
          </>
        ),
    },
    allocation: {
      title: "Allocation",
      icon: PieChart,
      accentVar: "--accent-2",
      body: (() => {
        const byKind = new Map<string, number>();
        for (const holding of holdings) {
          const value = holdingValue(holding);
          if (value === null) continue;
          const { converted } = sumInBase([{ amount: value, currency: holding.currency }], rates);
          const label = KINDS.find((k) => k.value === holding.kind)?.label ?? holding.kind;
          byKind.set(label, (byKind.get(label) ?? 0) + converted);
        }
        const slices = [...byKind.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
        if (slices.length === 0) return <p className="empty-state">Nothing priced yet.</p>;
        return <DonutChart data={slices} currency={base} />;
      })(),
    },
    add: {
      title: "Add a holding",
      icon: Plus,
      accentVar: "--accent-3",
      body: (
        <form onSubmit={add} style={{ display: "grid", gap: "0.4rem" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Vanguard FTSE All-World" required />
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (optional)" style={{ flex: 1 }} />
            <select value={kind} onChange={(e) => setKind(e.target.value as HoldingKind)} aria-label="Kind" style={{ flex: 1 }}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="Quantity" required style={{ flex: 1 }} />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              aria-label="Currency"
              style={{ width: 70 }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" placeholder="Cost per unit" style={{ flex: 1 }} />
            <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} inputMode="decimal" placeholder="Price now" style={{ flex: 1 }} />
          </div>
          <button type="submit" className="btn-accent" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : "Add holding"}
          </button>
          {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: 0 }}>{error}</p>}
        </form>
      ),
    },
    holdings: {
      title: "Holdings",
      icon: Coins,
      accentVar: "--accent-4",
      body:
        holdings.length === 0 ? (
          <p className="empty-state">No holdings yet.</p>
        ) : (
          <div>
            {holdings.map((holding) => (
              <HoldingRow key={holding.id} holding={holding} onChanged={refresh} />
            ))}
          </div>
        ),
    },
  };

  const widgets: WidgetSpec[] = WIDGETS.map((w) => ({
    ...w,
    title: bodies[w.id].title,
    icon: bodies[w.id].icon,
    accentVar: bodies[w.id].accentVar,
    render: () => bodies[w.id].body,
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Investments</h1>
          <p className="page-header__subtitle">
            What you hold, what it cost and what it is worth · prices are entered, not fetched
          </p>
        </div>
      </div>
      <WidgetCanvas storageKey="investments.layout.v1" widgets={widgets} />
    </div>
  );
}

/** One holding, with its price updatable in place. */
function HoldingRow({ holding, onChanged }: { holding: Holding; onChanged: () => void }) {
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const value = holdingValue(holding);
  const gain = holdingGain(holding);
  const current = latestPrice(holding);
  const lastPriced = holding.prices.length > 0 ? holding.prices[holding.prices.length - 1].priced_at : null;

  async function savePrice() {
    const parsed = Number(price.trim().replace(/[,\s]/g, ""));
    if (!Number.isFinite(parsed)) return;
    setBusy(true);
    try {
      await api.priceHolding(holding.id, parsed);
      setPrice("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteHolding(holding.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-row" style={{ flexWrap: "wrap" }}>
      <div className="account-row__info">
        <div className="account-row__name">
          {holding.name}
          {holding.ticker && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {holding.ticker}</span>}
        </div>
        <div className="account-row__meta">
          {holding.quantity} units
          {current !== null && <> at {formatCurrency(current, holding.currency)}</>}
          {holding.unit_cost != null && <> · cost {formatCurrency(holding.unit_cost, holding.currency)}</>}
          {lastPriced && <> · priced {lastPriced}</>}
        </div>
        {/* Said plainly rather than shown as zero: an unpriced holding is
            unknown, and a zero would be a claim about its worth. */}
        {current === null && (
          <div className="account-row__meta" style={{ color: "var(--critical)", fontSize: "0.72rem" }}>
            No price yet — not counted anywhere until there is one
          </div>
        )}
        <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginTop: "0.3rem" }}>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePrice()}
            inputMode="decimal"
            placeholder="New price"
            aria-label={`New price for ${holding.name}`}
            style={{ width: 110, fontSize: "0.78rem", padding: "0.15rem 0.35rem" }}
          />
          <button onClick={savePrice} disabled={busy || !price.trim()} style={{ fontSize: "0.78rem", padding: "0.15rem 0.5rem" }}>
            Update
          </button>
          {confirming ? (
            <>
              <button onClick={remove} disabled={busy} style={{ fontSize: "0.78rem", color: "var(--critical)" }}>
                Really remove
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} style={{ fontSize: "0.78rem" }}>
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} aria-label={`Remove ${holding.name}`} title="Remove" style={{ padding: "0.2rem" }}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className="account-row__balance">{value === null ? "—" : formatCurrency(value, holding.currency)}</span>
        {gain && (
          <span style={{ display: "block", fontSize: "0.72rem", color: gain.absolute >= 0 ? "var(--good)" : "var(--critical)" }}>
            {gain.absolute >= 0 ? "+" : ""}
            {formatCurrency(gain.absolute, holding.currency)}
            {gain.fraction !== null && ` (${(gain.fraction * 100).toFixed(1)}%)`}
          </span>
        )}
      </div>
    </div>
  );
}
