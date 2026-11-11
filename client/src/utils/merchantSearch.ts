import { cleanDescription } from "./cleanDescription.js";

/**
 * What to type into a search engine to find out who a merchant is.
 *
 * Bank descriptors are frequently unreadable — "MOBI MVCHAG05", "SP
 * ALL4CYCLING", "ACS*41382644" — and the only way anybody works out what one
 * is, is to search for it and find somebody else asking the same question.
 * There is no public database of how other people filed a transaction; what
 * there is, is other people having wondered the same thing out loud.
 *
 * **This text leaves the app.** That is the whole reason this is a separate,
 * tested function rather than a string built at the call site. A bank
 * descriptor can carry an IBAN, a card tail, a mandate reference or an
 * account number, and putting any of those into a search engine would hand
 * out an account identifier to find out the name of a shop. `cleanDescription`
 * already removes them, and the guard below is the second line: anything
 * still looking like an identifier is dropped rather than sent.
 *
 * Nothing here runs on its own. It produces a query for a button somebody
 * chooses to press, and the app never searches on anybody's behalf.
 */

/** A run of digits long enough to be an account, card or mandate number. */
const IDENTIFIER = /\d{5,}/;

/**
 * A token with no letters in it and long enough to be a reference.
 *
 * Deliberately not "any number": a shop can be called "Example 24", and
 * dropping the 24 both spoils the search and makes the button look broken.
 * Four characters is where a number stops reading as part of a name and
 * starts reading as the tail of something.
 */
const BARE_REFERENCE = /^[\d\W_]{4,}$/;

/**
 * Words that describe how the money moved rather than who received it.
 *
 * Not stripped — a merchant really can be called "Card Factory" — but a
 * descriptor made of nothing else names no merchant at all, and searching it
 * would return the definition of a direct debit.
 */
const GENERIC = new Set([
  "direct",
  "debit",
  "credit",
  "transfer",
  "transfers",
  "funds",
  "purchase",
  "payment",
  "payments",
  "standing",
  "order",
  "withdrawal",
  "deposit",
  "refund",
  "reversal",
  "fee",
  "fees",
  "charge",
  "charges",
  "card",
  "pos",
  "atm",
  "thank",
  "you",
]);

export function merchantSearchQuery(description: string | null | undefined, counterparty?: string | null): string | null {
  const name = cleanDescription(description) || (counterparty ?? "").trim();
  if (!name) return null;

  const words = name.split(/\s+/).filter((word) => !IDENTIFIER.test(word) && !BARE_REFERENCE.test(word));

  // Nothing recognisable left once the identifiers are gone, or nothing left
  // but the mechanics of the payment. Searching that would be pointless, and
  // searching the original would be the exact thing this is here to prevent.
  const named = words.some((word) => !GENERIC.has(word.toLowerCase().replace(/[^a-z]/g, "")));
  if (!named) return null;

  const safe = words.join(" ").trim();
  return safe.length < 3 ? null : safe;
}

/**
 * The URL that search opens at.
 *
 * DuckDuckGo rather than Google: this query describes where somebody shops,
 * and the search that answers "who is this merchant" should not also become a
 * durable record of it against an advertising profile. It is still a third
 * party receiving the merchant name, which is why the button says so.
 */
export function merchantSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(`${query} bank transaction`)}`;
}
