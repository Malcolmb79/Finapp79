import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * What has been looked at, and when.
 *
 * The commitments card already knows what every subscription costs. What it
 * cannot know is which of them anybody has actually decided about — and that
 * is the whole failure mode of a subscription: the charge is small enough
 * that no month forces the issue, so the only thing that ever surfaces it is
 * noticing you have not thought about it since the year before last.
 *
 * Deliberately a stamp rather than a judgement. There is no "keep" and no
 * "cancel" verdict stored, because a verdict goes stale and a date does not:
 * "confirmed in March 2025" stays exactly as true and exactly as useful
 * eighteen months later, where "keep" quietly becomes a decision nobody
 * remembers making.
 */

export const subscriptionReviewsRouter = Router();
subscriptionReviewsRouter.use(requireAuth);

export interface SubscriptionReview {
  merchant_key: string;
  label: string;
  reviewed_at: string | null;
}

/** Today as an ISO date, matching how every other date in this app is stored. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

subscriptionReviewsRouter.get("/", async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT merchant_key, label, reviewed_at
         FROM subscription_reviews WHERE user_id = ? ORDER BY label`
    )
    .all(req.user!.id)) as unknown as SubscriptionReview[];
  res.json(rows);
});

/**
 * Records a look.
 *
 * An upsert on (user, merchant key) rather than an insert: reviewing the same
 * subscription a year later is the same row with a newer date, and a table of
 * every time anybody glanced at Netflix would answer no question this page
 * asks.
 */
subscriptionReviewsRouter.post("/", async (req, res) => {
  const { merchant_key, label, reviewed } = req.body as Record<string, unknown>;

  if (typeof merchant_key !== "string" || !merchant_key.trim()) {
    res.status(400).json({ error: "Say which subscription this is about." });
    return;
  }
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "A review needs the name it was reviewed under." });
    return;
  }

  const key = merchant_key.trim();
  const existing = (await db
    .prepare("SELECT reviewed_at FROM subscription_reviews WHERE user_id = ? AND merchant_key = ?")
    .get(req.user!.id, key)) as unknown as Pick<SubscriptionReview, "reviewed_at"> | undefined;

  // Absent means "leave as it was"; false is an explicit undo, for a mis-click.
  const reviewedAt = "reviewed" in req.body ? (reviewed ? today() : null) : (existing?.reviewed_at ?? null);

  if (existing) {
    await db
      .prepare("UPDATE subscription_reviews SET label = ?, reviewed_at = ? WHERE user_id = ? AND merchant_key = ?")
      .run(label.trim(), reviewedAt, req.user!.id, key);
  } else {
    await db
      .prepare("INSERT INTO subscription_reviews (id, user_id, merchant_key, label, reviewed_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), req.user!.id, key, label.trim(), reviewedAt);
  }

  res.status(201).json({ merchant_key: key, label: label.trim(), reviewed_at: reviewedAt });
});

export default subscriptionReviewsRouter;
