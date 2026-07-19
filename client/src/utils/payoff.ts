/**
 * Months to pay off a debt at a fixed monthly payment, via standard loan
 * amortization. Returns null if the payment doesn't even cover a month's
 * interest, since the balance would never shrink at that rate.
 */
export function monthsToPayoff(balance: number, apr: number, monthlyPayment: number): number | null {
  if (balance <= 0) return 0;
  if (monthlyPayment <= 0) return null;

  const monthlyRate = apr / 100 / 12;
  if (monthlyRate === 0) return Math.ceil(balance / monthlyPayment);

  const monthlyInterest = balance * monthlyRate;
  if (monthlyPayment <= monthlyInterest) return null;

  const months = -Math.log(1 - (balance * monthlyRate) / monthlyPayment) / Math.log(1 + monthlyRate);
  return Math.ceil(months);
}
