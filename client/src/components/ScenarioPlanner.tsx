import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "../utils/formatCurrency.js";
import { fireTimeline } from "../utils/fire.js";
import { applyScenario, baseScenario, EMPTY_CHANGE, scenarioVerdict, type Baseline, type ScenarioChange } from "../utils/scenario.js";

/**
 * Two futures beside the one you are in.
 *
 * Everything else in this app runs from where the household actually is. This
 * runs the same arithmetic on different inputs, which is the only honest way
 * to compare two choices neither of which has been made.
 *
 * Four sliders, not twenty, and each starts at zero rather than at a guess —
 * so a scenario is read as "the household as it is, plus this change", and an
 * untouched column is visibly identical to the first one. A planner that
 * opened with invented numbers in it would be answering a question nobody
 * asked.
 */

export interface ScenarioProps {
  baseline: Baseline;
  currency: string;
}

const PRESETS: { label: string; change: Omit<ScenarioChange, "name">; name: string }[] = [
  {
    label: "A second income",
    name: "Second income",
    change: { ...EMPTY_CHANGE, incomeChange: 800 },
  },
  {
    label: "Clear the debt",
    name: "Debt cleared",
    change: { ...EMPTY_CHANGE, debtChange: -10000, expenseChange: -300 },
  },
  {
    label: "Rent goes up",
    name: "Rent up",
    change: { ...EMPTY_CHANGE, expenseChange: 250 },
  },
];

const SLIDERS: {
  key: keyof Pick<ScenarioChange, "incomeChange" | "expenseChange" | "assetChange" | "debtChange">;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Which direction is the welcome one, so the figure can be coloured honestly. */
  goodWhen: "up" | "down";
}[] = [
  { key: "incomeChange", label: "Income a month", min: -5000, max: 5000, step: 50, goodWhen: "up" },
  { key: "expenseChange", label: "Spending a month", min: -5000, max: 5000, step: 50, goodWhen: "down" },
  { key: "assetChange", label: "Assets, one-off", min: -200000, max: 200000, step: 1000, goodWhen: "up" },
  { key: "debtChange", label: "Debt, one-off", min: -200000, max: 200000, step: 1000, goodWhen: "down" },
];

export default function ScenarioPlanner({ baseline, currency }: ScenarioProps) {
  const [scenarios, setScenarios] = useState<ScenarioChange[]>([
    { name: "Scenario A", ...EMPTY_CHANGE },
    { name: "Scenario B", ...EMPTY_CHANGE },
  ]);
  const money = (value: number) => formatCurrency(value, currency);

  const now = useMemo(() => baseScenario(baseline, "Now"), [baseline]);
  const results = useMemo(() => scenarios.map((s) => applyScenario(baseline, s, now)), [baseline, scenarios, now]);

  function update(index: number, patch: Partial<ScenarioChange>) {
    setScenarios((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  /**
   * Which column a preset fills: the first one nobody has touched.
   *
   * Always filling the first would make the second preset silently overwrite
   * the first, so two clicks would leave one scenario rather than the two the
   * row appears to be offering. Once both are in use it does overwrite the
   * first, which is at least visible.
   */
  function applyPreset(change: Omit<ScenarioChange, "name">, name: string) {
    const untouched = scenarios.findIndex((s) =>
      SLIDERS.every((slider) => s[slider.key] === 0)
    );
    update(untouched === -1 ? 0 : untouched, { name, ...change });
  }

  const columns = [now, ...results];

  return (
    <>
      <div className="scenarios">
        {columns.map((result, index) => {
          const scenario = index === 0 ? null : scenarios[index - 1];
          return (
            <div key={result.name} className="scenario" data-base={index === 0 ? "true" : undefined}>
              <header className="scenario__header">
                {scenario ? (
                  <input
                    value={scenario.name}
                    onChange={(e) => update(index - 1, { name: e.target.value })}
                    aria-label={`Name for scenario ${index}`}
                    className="scenario__name"
                  />
                ) : (
                  <span className="scenario__name scenario__name--base">Now</span>
                )}
                {scenario && (
                  <button
                    onClick={() => update(index - 1, EMPTY_CHANGE)}
                    title="Back to no change"
                    className="scenario__reset"
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
              </header>

              <dl className="scenario__figures">
                <div>
                  <dt>Net worth</dt>
                  <dd>{money(result.netWorth)}</dd>
                </div>
                <div>
                  <dt>Cash flow</dt>
                  <dd style={{ color: result.monthlyCashFlow < 0 ? "var(--critical)" : undefined }}>
                    {money(result.monthlyCashFlow)}/mo
                  </dd>
                </div>
                <div>
                  <dt>Your number</dt>
                  <dd>{result.fire.target > 0 ? money(result.fire.target) : "—"}</dd>
                </div>
                <div>
                  <dt>Work optional in</dt>
                  <dd style={{ color: result.fire.months === null ? "var(--critical)" : undefined }}>
                    {fireTimeline(result.fire)}
                  </dd>
                </div>
              </dl>

              {scenario ? (
                <>
                  <div className="scenario__sliders">
                    {SLIDERS.map((slider) => {
                      const value = scenario[slider.key];
                      const better = slider.goodWhen === "up" ? value > 0 : value < 0;
                      return (
                        <label key={slider.key}>
                          <span className="scenario__slider-label">
                            {slider.label}
                            <strong style={{ color: value === 0 ? undefined : better ? "var(--good)" : "var(--critical)" }}>
                              {value > 0 ? "+" : ""}
                              {money(value)}
                            </strong>
                          </span>
                          <input
                            type="range"
                            min={slider.min}
                            max={slider.max}
                            step={slider.step}
                            value={value}
                            onChange={(e) => update(index - 1, { [slider.key]: Number(e.target.value) })}
                            aria-label={`${slider.label} for ${scenario.name}`}
                          />
                        </label>
                      );
                    })}
                  </div>

                  {/* Only when there is an asset change to qualify. A toggle
                      that is always on screen asking about money nobody has
                      moved is a question with no subject. */}
                  {scenario.assetChange !== 0 && (
                    <label className="scenario__toggle">
                      <input
                        type="checkbox"
                        checked={scenario.assetIsInvestable ?? false}
                        onChange={(e) => update(index - 1, { assetIsInvestable: e.target.checked })}
                      />
                      <span>
                        That asset can be drawn on
                        <em>
                          Money into investments brings the date forward. Equity in a home you live in does not — it does not
                          pay for groceries.
                        </em>
                      </span>
                    </label>
                  )}

                  <p className="scenario__verdict">{scenarioVerdict(result, money)}</p>
                </>
              ) : (
                <p className="scenario__verdict scenario__verdict--base">
                  Your actual figures. Everything beside this is measured against it.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="scenario__presets">
        <span>Try:</span>
        {PRESETS.map((preset) => (
          <button key={preset.label} onClick={() => applyPreset(preset.change, preset.name)}>
            {preset.label}
          </button>
        ))}
      </div>

      <ul className="report__notes" style={{ marginTop: "0.6rem" }}>
        <li>
          Nothing here models interest on a debt you take on or pay off — the Debt Planner does that properly. These sliders
          move the balance sheet, not the cost of carrying it.
        </li>
        <li>Every scenario starts from your real position, so an untouched column reads the same as &ldquo;Now&rdquo;.</li>
      </ul>
    </>
  );
}
