/**
 * What a balance quoted as "left to pay" is actually worth today.
 *
 * A lender's remaining balance is frequently the sum of the instalments still
 * to come rather than the outstanding principal. The two differ by every penny
 * of future interest, and the payoff projection charges interest on whatever
 * balance it is handed — so recording the first as the second inflates the
 * debt and then adds interest on top of the inflation.
 *
 * Deliberately a copy of the server's `impliedPrincipal` rather than an import
 * of it: the two workspaces share no runtime code, and the alternative is a
 * round trip to ask a question that is four lines of arithmetic. The server's
 * copy is the one under test for the reading path; this one is tested here.
 */

/**
 * The present value of the payments still to come, or null when it cannot be
 * worked out honestly.
 *
 * Assumes the quoted rate is the one applied to the balance each month, which
 * holds for a straightforward amortising loan and not for every product that
 * quotes an APR. That is why the figure is offered for agreement on screen
 * rather than stored on its own authority.
 */
export function impliedPrincipal(
  remaining: number | null,
  monthlyPayment: number | null,
  annualRate: number | null
): number | null {
  if (remaining == null || monthlyPayment == null || annualRate == null) return null;
  if (monthlyPayment <= 0 || remaining <= 0) return null;

  const payments = Math.round(remaining / monthlyPayment);
  if (payments < 1 || payments > 600) return null;

  // No interest quoted means there is nothing to discount: what is left to pay
  // is what is owed.
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate <= 0) return remaining;

  const value = monthlyPayment * ((1 - Math.pow(1 + monthlyRate, -payments)) / monthlyRate);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}
