import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Which alerts have been read, and what they said at the time.
 *
 * The bell's alerts are derived from the data, never stored — a budget that
 * is over is over whether or not a row says so. That is the right design and
 * it has one consequence nobody had dealt with: there is nothing to mark as
 * read, so every alert sat there for as long as its condition lasted. A badge
 * that never goes down is a badge nobody reads, which costs the one alert
 * that mattered.
 *
 * So a dismissal is a note that somebody has seen *this* alert *in this
 * state*. Two things keep it from becoming a way to hide a problem:
 *
 *   The **severity** comes with it. A budget read at 91% spent comes back
 *   when it goes over, because that is a different thing to know.
 *
 *   The dismissal is **pruned when the alert stops being derived**, which the
 *   client does as it reads. A condition that resolves and returns next month
 *   is news again rather than something already marked read — and the table
 *   never accumulates rows for alerts that no longer exist.
 */

export const alertDismissalsRouter = Router();
alertDismissalsRouter.use(requireAuth);

export interface AlertDismissal {
  alert_id: string;
  severity: string;
  dismissed_at: string;
}

alertDismissalsRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare("SELECT alert_id, severity, dismissed_at FROM alert_dismissals WHERE user_id = ?")
    .all(req.user!.id);
  res.json(rows);
});

/**
 * Reading one, or reading the lot.
 *
 * Takes a list rather than one id, because "mark all as read" is the gesture
 * this exists for and sending six requests for it would leave the badge
 * flickering down one at a time.
 */
alertDismissalsRouter.post("/", async (req, res) => {
  const items = Array.isArray(req.body?.alerts) ? req.body.alerts : null;
  if (!items) {
    res.status(400).json({ error: "alerts must be a list of { alert_id, severity }" });
    return;
  }

  const clean = items
    .map((item: { alert_id?: unknown; severity?: unknown }) => ({
      alert_id: typeof item?.alert_id === "string" ? item.alert_id.trim() : "",
      severity: typeof item?.severity === "string" ? item.severity.trim() : "",
    }))
    .filter((item: { alert_id: string; severity: string }) => item.alert_id !== "" && item.severity !== "");

  for (const item of clean) {
    // Overwritten rather than ignored on conflict: reading an alert that has
    // got worse since it was last read is what updates the severity, and
    // without that it would go on being hidden at the old one.
    await db
      .prepare(
        `INSERT INTO alert_dismissals (user_id, alert_id, severity) VALUES (?, ?, ?)
         ON CONFLICT (user_id, alert_id) DO UPDATE SET severity = EXCLUDED.severity, dismissed_at = EXCLUDED.dismissed_at`
      )
      .run(req.user!.id, item.alert_id, item.severity);
  }

  res.json({ dismissed: clean.length });
});

/**
 * Forgetting the dismissals for alerts that no longer exist.
 *
 * The client sends the ids it is currently deriving; everything else of this
 * user's is dropped. Sent as "what is live" rather than "delete this one"
 * because the client cannot name what it no longer knows about — the whole
 * point is the alerts that have gone away.
 */
alertDismissalsRouter.post("/prune", async (req, res) => {
  const live = Array.isArray(req.body?.live) ? req.body.live.filter((id: unknown) => typeof id === "string") : null;
  if (!live) {
    res.status(400).json({ error: "live must be a list of alert ids" });
    return;
  }

  if (live.length === 0) {
    await db.prepare("DELETE FROM alert_dismissals WHERE user_id = ?").run(req.user!.id);
    res.json({ pruned: "all" });
    return;
  }

  const placeholders = live.map(() => "?").join(", ");
  await db
    .prepare(`DELETE FROM alert_dismissals WHERE user_id = ? AND alert_id NOT IN (${placeholders})`)
    .run(req.user!.id, ...live);
  res.status(204).send();
});
