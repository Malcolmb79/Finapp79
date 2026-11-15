import type { Transaction } from "../api/client.js";
import { isTruncationOf, type DuplicateGroup } from "./findDuplicates.js";

/**
 * How good the evidence is that one flagged row is a copy of another.
 *
 * Every pair used to be presented alike, which made the screen useless for
 * deciding: a card payment the bank described twice sat next to two different
 * shops that happened to charge the same amount on the same day, and nothing
 * on either said which was which. Somebody working down the list either
 * trusts all of it and deletes a real payment, or trusts none of it and the
 * list never shrinks.
 *
 * Graded per row rather than per group, because that is where the decision
 * is. A group is only "these all share an account, a date and an amount", and
 * three identical rows beside one from a different shop is an ordinary shape:
 * grading the group by its weakest member labelled the three identical ones
 * "probably not", which is wrong about them, and grading by its strongest
 * would have been wrong about the fourth in the direction that costs a
 * payment.
 *
 * The description is what separates the three cases:
 *
 * - **A day or so apart, one description the other cut short.** One payment,
 *   described by two pipelines. This is the expected-and-recorded pair and the
 *   import-meets-sync pair, and it is near certain.
 * - **Same day, same wording.** The same payment twice, or the same purchase
 *   twice. Strong, and still worth a look: a coffee and another coffee.
 * - **Same day, different wording.** Two different merchants that charged the
 *   same amount. Usually two payments, and the one the list should stop
 *   somebody deleting in a hurry.
 */

export type Strength = "near-certain" | "likely" | "weak";

export interface Evidence {
  strength: Strength;
  /** What the screen says about this row, in the terms of the evidence. */
  note: string;
}

/** Strongest first, so the easy decisions are at the top of the list. */
export const STRENGTH_ORDER: Record<Strength, number> = { "near-certain": 0, likely: 1, weak: 2 };

function sameWording(a: Transaction, b: Transaction): boolean {
  const norm = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a.description) === norm(b.description);
}

/** The verdict on one copy against the row it is a copy of. */
export function copyEvidence(original: Transaction, copy: Transaction, kind: DuplicateGroup["kind"]): Evidence {
  if (kind === "days-apart" && original.booking_date !== copy.booking_date) {
    return {
      strength: "near-certain",
      note: "Same merchant a day or so apart, with the name cut short on one of them - one payment the bank described twice.",
    };
  }

  if (sameWording(original, copy)) {
    return {
      strength: "likely",
      note: "Same day, same amount, same description. Two separate purchases would look like this too.",
    };
  }

  if (isTruncationOf(original.description, copy.description)) {
    return {
      strength: "likely",
      note: "Same day and amount, and the descriptions name the same merchant written two ways.",
    };
  }

  // The dangerous one. Said plainly rather than ranked quietly down the list,
  // because the cost of getting it wrong is a real payment disappearing.
  return {
    strength: "weak",
    note: "Same day and amount, but the descriptions name different things. Most likely two separate payments.",
  };
}

/**
 * The group's place in the list: its strongest copy.
 *
 * Only for ordering. What each row says about itself comes from
 * {@link copyEvidence}, so a mixed group is not summarised into one verdict
 * that is wrong about half of it.
 */
export function duplicateEvidence(group: DuplicateGroup): Evidence {
  const graded = group.copies.map((copy) => copyEvidence(group.original, copy, group.kind));
  if (graded.length === 0) return { strength: "weak", note: "Nothing to compare." };
  return graded.reduce((best, e) => (STRENGTH_ORDER[e.strength] < STRENGTH_ORDER[best.strength] ? e : best));
}
