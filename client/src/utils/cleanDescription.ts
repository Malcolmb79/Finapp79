/**
 * The name of a transaction, as a person would say it.
 *
 * A bank description is written for a ledger, not for reading: AIB sends
 * "VDP-MGP*Vinted Purchase" and "D/D SPECSAVERS IE26102913874138
 * 4040478-2414-117219 Direct debit". Every part of that is true and almost
 * none of it is the answer to "what was this?".
 *
 * Nothing is lost by cleaning. The original is still on the transaction and
 * is shown in full on its detail card, so this is a display name rather than
 * a replacement — which is what makes it safe to be as aggressive as it is.
 *
 * Built against real descriptions rather than guessed formats; the patterns
 * below each name the thing they were written for.
 */

/**
 * How the card scheme or payment rail announces itself, always at the front.
 * VDP is a Visa debit purchase, VDC a contactless one, D/D a direct debit —
 * none of which identifies the merchant, which is the only thing being asked.
 */
const RAIL_PREFIX = /^(?:vdp|vdc|vd|pos|atm|crd|chq|d\/d|dd|s\/o|so|tfr|trf|dr|cr)[-\s:]+/i;

/**
 * The transaction type, appended by the provider from its own `type` field
 * rather than coming from the bank's text. It is the same handful of words on
 * thousands of rows and says nothing a glance at the amount doesn't.
 */
const TRAILING_TYPE =
  /\s+(?:purchase|direct debit|standing order|funds? transfer|fees? and charges|credit transfer|card payment|withdrawal|deposit|refund|reversal)\s*$/i;

/** "12.30 USD@ 1.113122 INCL FX FEE E0.45" — the conversion, not the payee. */
const FX_TAIL = /\s+[\d.,]+\s*[A-Z]{3}\s*@[^A-Za-z]*(?:incl\s*fx\s*fee\s*\S+)?/gi;

/** An IBAN sitting in the middle of a direct debit reference. */
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{8,26}\b/g;

/** Mandate and scheme references: long digit runs, or dash-joined numbers. */
const REFERENCE = /\b\d[\d-]{7,}\b/g;

/**
 * A date the bank stamped into the text.
 *
 * The third form is the one that hides: "TxnDate: 03Sep2026" has no
 * separators for a numeric pattern to catch, so it survived every other rule
 * and sat in the middle of the name — which also stopped the repeated-phrase
 * rule below collapsing "MOBI MVCHAG05 ... MOBI MVCHAG05", because the halves
 * were no longer equal with a date wedged between them.
 */
const DATE =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/.]\d{2}[/.]\d{2,4}\b|\b(?:txn\s*date|date)\s*:?\s*\d{1,2}[a-z]{3}\d{2,4}\b|\b\d{1,2}[a-z]{3}\d{4}\b/gi;

/** A masked card or account tail, e.g. "Revolut**9855*". */
const MASKED_TAIL = /\*+\d+\**/g;

/**
 * A payment processor in front of the merchant: "MGP*Vinted", "SP ALL4CYCLING",
 * "TST-Sasta Cafe". The merchant is the part worth keeping, but only when
 * there is enough of it left to be a name — "ANTHROPIC* CLA" must keep its
 * front half, not its truncated tail.
 */
const PROCESSOR = /^(?:sq|sp|tst|mgp|paypal|pp|wix|sumup|zettle|izettle)[-*\s]+/i;

/** Words that stay lowercase inside a title-cased name. */
const SMALL_WORDS = new Set(["and", "of", "the", "at", "in", "on", "for", "to", "a", "an", "de", "la", "le"]);

/**
 * Sentence case for a SHOUTED name, left alone otherwise.
 *
 * Banks send merchant names in capitals because their systems always have.
 * "DUNNES MAYNOOT" reads as shouting on screen next to everything else, and
 * a name the bank already sent in mixed case ("Amazon.ie", "O'Neills Bar")
 * was written by someone who meant it, so it is not touched.
 */
function tidyCase(text: string): string {
  if (text !== text.toUpperCase()) return text;

  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, index) => {
      if (/^\s+$/.test(word)) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      // Keeps an apostrophe's or hyphen's following letter capitalised too:
      // "o'neills" -> "O'Neills", "all4cycling" -> "All4cycling".
      return word.replace(/^[a-z]|(?<=[-'’])[a-z]/g, (letter) => letter.toUpperCase());
    })
    .join("");
}

export function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";

  let text = raw
    // Some banks append a structured metadata blob in curly braces after the
    // payee, e.g. "ANTHROPIC { TransactionSubType : Purchase, ... }".
    .replace(/\{[^{}]*\}/g, " ")
    .replace(TRAILING_TYPE, " ")
    .replace(FX_TAIL, " ")
    .replace(IBAN, " ")
    .replace(DATE, " ")
    .replace(REFERENCE, " ")
    .trim();

  text = text.replace(RAIL_PREFIX, "").replace(PROCESSOR, "").replace(MASKED_TAIL, " ");

  text = text
    // A URL the bank tacked on after the name.
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\s{2,}/g, " ")
    // An asterisk stuck to the front of a word. Banks use it to mark the
    // payee within a longer descriptor, and it is not part of the name — it
    // also defeats both repeat rules below, because "EXAMPLE CO" and
    // "*EXAMPLE CO" are not equal however obviously they are the same thing.
    .replace(/(^|\s)\*+(?=\S)/g, "$1")
    // A word repeated back to back, which stripping a reference from between
    // two copies of a name produces.
    .replace(/\b(\S+)(\s+\1\b)+/gi, "$1")
    // Punctuation left stranded by everything removed above.
    .replace(/[\s,;:*\-–—]+$/, "")
    .replace(/^[\s,;:*\-–—]+/, "")
    .trim();

  // Everything was noise: better the original than an empty row, since a
  // name nobody can read still beats no name at all.
  if (!text) return raw.replace(/\s{2,}/g, " ").trim();

  return tidyCase(dedupeHalves(text));
}

/**
 * A whole name said twice, which is what stripping a reference from between
 * two copies of it leaves behind: "EXAMPLE CO 00000 EXAMPLE CO" becomes
 * "EXAMPLE CO EXAMPLE CO" and should read as the name once.
 *
 * Only an exact two-half repeat, so "Office Office Supplies" — a real name
 * that happens to repeat a word — is left alone.
 */
function dedupeHalves(text: string): string {
  const words = text.split(" ");
  if (words.length < 2 || words.length % 2 !== 0) return text;

  const half = words.length / 2;
  const front = words.slice(0, half);
  const back = words.slice(half);
  return front.every((word, i) => word.toLowerCase() === back[i].toLowerCase()) ? front.join(" ") : text;
}
