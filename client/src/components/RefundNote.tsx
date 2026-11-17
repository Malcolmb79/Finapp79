import type { CategorySpend } from "../utils/categorySpend.js";

/**
 * What the category totals had taken off them.
 *
 * Netting a refund against the category it came back to is right — it is what
 * the money did, and it is what makes these shares add up to the expenses
 * figure beside them. But netting in silence trades one invisible fact for
 * another: before, the refund was missing from the total; after, it would be
 * missing from the screen.
 *
 * So the figure is named, and so is any category that took back more than it
 * ever spent — individually, because "Transport took back more than it spent"
 * is a statement somebody can go and check, where "€56 of refunds" is one
 * they can only accept. The detail itself lives in `categoryBreakdown.ts`,
 * one click away through the category's own name.
 */
export default function RefundNote({
  spend,
  money,
}: {
  spend: CategorySpend;
  money: (value: number) => string;
}) {
  const { refunded, overRefunded } = spend;
  if (refunded <= 0.005 && overRefunded.length === 0) return null;

  return (
    <p className="trend-head__detail" style={{ margin: "0.5rem 0 0" }}>
      {refunded > 0.005 && <>{money(refunded)} of refunds taken off the categories they came back to. </>}
      {overRefunded.map((category) => (
        <span key={category.name}>
          {category.name} took back {money(category.amount)} more than it spent, so it is in no bar.{" "}
        </span>
      ))}
    </p>
  );
}
