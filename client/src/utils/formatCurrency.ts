const formatters = new Map<string, Intl.NumberFormat>();

// Intl falls back to the three-letter code whenever the locale has no symbol
// for a currency, so a South African account reads "ZAR 1,234.56" on a
// browser set to English (Ireland). These are the symbols to use instead --
// what the bank itself prints.
const SYMBOLS: Record<string, string> = {
  ZAR: "R",
};

export function formatCurrency(amount: number, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    // narrowSymbol keeps it to "$" rather than "US$" where a locale would
    // otherwise disambiguate -- these are one person's own accounts, so the
    // disambiguation is noise. It predates iOS 14.1, so fall back rather than
    // let a RangeError take the page down on an older phone.
    try {
      formatter = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" });
    } catch {
      formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    }
    formatters.set(currency, formatter);
  }

  const formatted = formatter.format(amount);
  const symbol = SYMBOLS[currency];
  // Only rewrite when the code actually leaked through: a locale that already
  // renders ZAR as "R" needs nothing doing, and a blind replace would corrupt
  // it. The separator goes with it, since "R 1,234.56" isn't how the symbol is
  // written -- and Intl uses a non-breaking space there, not a plain one, so
  // both spellings have to be handled.
  if (!symbol || !formatted.includes(currency)) return formatted;
  return formatted.replace(currency, symbol).replace(`${symbol} `, symbol).replace(`${symbol} `, symbol);
}
