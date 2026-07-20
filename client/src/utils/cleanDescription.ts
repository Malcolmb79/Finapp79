// Some banks (via Enable Banking's remittance_information) append a
// structured metadata blob in curly braces after the real payee name, e.g.
// "ANTHROPIC { TransactionSubType : Purchase, PaymentInitiationDateTime :
// 2026-07-19T19:31:37+01:00 }" — strip that out for display.
export function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
