export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Sequential (single-hue) magnitude comparison — not categorical identity,
 * so every bar shares one hue rather than a color-per-row. Value is
 * direct-labeled at the tip since there's no room for a separate axis.
 */
export default function MagnitudeBarList({ data, mode = "chart" }: { data: BarDatum[]; mode?: "chart" | "number" }) {
  if (data.length === 0) return <p className="empty-state">Nothing to show yet.</p>;

  const max = Math.max(0, ...data.map((d) => d.value));

  if (mode === "number") {
    const total = data.reduce((s, d) => s + d.value, 0);
    const top = data[0];
    return (
      <div>
        <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
          Total spend
        </p>
        <p className="stat-tile__value" style={{ fontSize: "2rem" }}>
          {total.toFixed(2)}
        </p>
        <p className="page-header__subtitle" style={{ margin: "0.3rem 0 0" }}>
          Top category: {top.label} ({top.value.toFixed(2)})
        </p>
      </div>
    );
  }

  return (
    <div>
      {data.map((d) => {
        const pct = max > 0 ? (d.value / max) * 100 : 0;
        return (
          <div className="bar-list__row" key={d.label}>
            <div className="bar-list__meta">
              <span>{d.label}</span>
              <strong>{d.value.toFixed(2)}</strong>
            </div>
            <div className="bar-list__track">
              <div className="bar-list__fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
