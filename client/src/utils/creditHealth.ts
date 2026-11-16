import type { Account } from "../api/client.js";

/**
 * How much of the available credit is being used.
 *
 * Utilisation is the one input to a credit file that moves fastest and is
 * almost entirely under the holder's control — it is recalculated every
 * statement, unlike a payment history that takes years to repair. It is also
 * the one nobody can see without doing the division, because a card shows a
 * balance and a limit on different screens.
 *
 * Two facts about how it is scored make the per-card figure matter as much as
 * the total. Lenders look at each account as well as the aggregate, so one
 * card at ninety-five per cent drags the file down even while the overall
 * figure looks fine. And the reported figure is the statement balance, not the
 * balance after the payment clears — paying in full every month still reports
 * high utilisation if the statement is cut while the card is loaded.
 *
 * Nothing here is a credit score. A score needs the file itself, which this
 * app has no access to and should not pretend to; what it can do is the
 * arithmetic that sits underneath one.
 */

/** Where the rules of thumb sit. Under 30% is the common advice; under 10% is where the best files sit. */
export const GOOD_UTILISATION = 0.3;
export const EXCELLENT_UTILISATION = 0.1;

export interface CardUtilisation {
  account: Account;
  /** What is owed, positive. */
  drawn: number;
  limit: number;
  /** Drawn over limit, as a fraction. Null when no limit is recorded. */
  utilisation: number | null;
  /** What could still be spent. */
  headroom: number;
  /** What paying this card down to the good threshold would take. */
  toGood: number;
}

export interface CreditHealth {
  cards: CardUtilisation[];
  totalDrawn: number;
  totalLimit: number;
  /** Across everything, which is what the aggregate figure on a file looks like. */
  overall: number | null;
  /** Cards above the common threshold — the ones a lender looks at individually. */
  strained: CardUtilisation[];
  /** Cards with no limit recorded, so a total can say what it could not see. */
  unknownLimits: number;
}

/**
 * Only revolving credit, which is what utilisation means.
 *
 * A mortgage at ninety per cent of its original value is not a household
 * using ninety per cent of its credit — an instalment loan has no revolving
 * limit and including it would produce a figure that is high for everybody
 * who has ever borrowed to buy a house. An arranged overdraft is revolving and
 * does count: it is a limit that can be drawn and repaid at will, which is the
 * test.
 */
function revolving(account: Account): boolean {
  if (account.account_type === "credit_card") return true;
  return (account.account_type ?? "current") === "current" && (account.overdraft_limit ?? 0) > 0;
}

/**
 * @param convert Restates an amount in the reported currency, or returns null
 *   when it cannot. Each card's own percentage is a ratio of two figures in
 *   one currency and needs no conversion — but the totals add across cards,
 *   and a sterling balance over a euro limit is the mistake every other total
 *   in this app refuses to make. A card that cannot be converted keeps its own
 *   percentage and stays out of the aggregate.
 */
export function creditHealth(
  accounts: Account[],
  balances: Map<string, number>,
  convert: (amount: number, currency: string) => number | null = (amount) => amount
): CreditHealth {
  const cards: CardUtilisation[] = [];
  let totalDrawn = 0;
  let totalLimit = 0;
  let unknownLimits = 0;

  for (const account of accounts.filter(revolving)) {
    const balance = balances.get(account.id) ?? 0;
    // A card in credit is owing nothing, not owing a negative amount.
    const drawn = Math.max(0, -balance);
    const limit = account.overdraft_limit ?? 0;

    if (limit > 0) {
      const drawnInBase = convert(drawn, account.currency);
      const limitInBase = convert(limit, account.currency);
      if (drawnInBase !== null && limitInBase !== null) {
        totalDrawn += drawnInBase;
        totalLimit += limitInBase;
      }
    } else {
      unknownLimits += 1;
    }

    const utilisation = limit > 0 ? drawn / limit : null;
    cards.push({
      account,
      drawn,
      limit,
      utilisation,
      headroom: Math.max(0, limit - drawn),
      // What it would take to get this card under the threshold, which is a
      // more actionable figure than the percentage it is derived from.
      toGood: limit > 0 ? Math.max(0, drawn - limit * GOOD_UTILISATION) : 0,
    });
  }

  cards.sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1));

  return {
    cards,
    totalDrawn,
    totalLimit,
    overall: totalLimit > 0 ? totalDrawn / totalLimit : null,
    strained: cards.filter((card) => card.utilisation !== null && card.utilisation > GOOD_UTILISATION),
    unknownLimits,
  };
}

export function utilisationTone(utilisation: number | null): "good" | "warning" | "critical" | "muted" {
  if (utilisation === null) return "muted";
  if (utilisation <= EXCELLENT_UTILISATION) return "good";
  if (utilisation <= GOOD_UTILISATION) return "good";
  if (utilisation <= 0.6) return "warning";
  return "critical";
}

/**
 * What the figure means, said once rather than left as a percentage.
 *
 * The per-card sentence names the amount that would fix it, because "72%" is a
 * diagnosis and "pay €840 off this card" is something somebody can do.
 */
export function utilisationNote(card: CardUtilisation, money: (value: number) => string): string {
  if (card.utilisation === null) {
    return "No credit limit recorded, so there is no utilisation to work out. Add the limit on the Accounts page.";
  }
  if (card.drawn === 0) return "Nothing owed on it.";
  if (card.utilisation <= EXCELLENT_UTILISATION) return `Using ${(card.utilisation * 100).toFixed(0)}% of the limit — about as low as it is read.`;
  if (card.utilisation <= GOOD_UTILISATION) return `Using ${(card.utilisation * 100).toFixed(0)}% of the limit, which is inside the usual advice.`;
  return `Using ${(card.utilisation * 100).toFixed(0)}% of the limit. Paying ${money(card.toGood)} off it would bring it under 30%.`;
}
