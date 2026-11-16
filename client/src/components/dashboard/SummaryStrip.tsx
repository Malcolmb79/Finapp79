import { BASIS_LABEL, type SummaryFigure } from "../../utils/dashboardSummary.js";

/**
 * The headline figures, in a row.
 *
 * Every budgeting template has this strip and every one of them makes the
 * same mistake: five identical pills inviting five figures to be read as one
 * set. They are not. Income and spending are flows through a month, debt and
 * savings are what stands right now, and a budget is a decision about a month
 * that has not finished.
 *
 * So each tile prints what it is a measure of. It costs a line of small text
 * and it is the difference between a dashboard that informs and one that just
 * looks busy.
 */

export default function SummaryStrip({
  figures,
  money,
}: {
  figures: SummaryFigure[];
  money: (value: number) => string;
}) {
  return (
    <div className="summary-strip">
      {figures.map((figure) => (
        <div key={figure.key} className="summary-tile" data-tone={figure.tone}>
          <p className="summary-tile__label">{figure.label}</p>
          <p className="summary-tile__value">{money(figure.amount)}</p>
          <p className="summary-tile__basis">
            {BASIS_LABEL[figure.basis]}
            {figure.detail ? ` · ${figure.detail}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
