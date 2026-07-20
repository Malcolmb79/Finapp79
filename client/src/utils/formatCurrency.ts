const formatters = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(amount);
}
