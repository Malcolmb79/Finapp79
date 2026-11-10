import { Router } from "express";
import { linkedAccounts, recordSyncAttempt, syncAccount } from "../services/accountSync.js";
import { cleanRemittanceInfo, transactionId } from "./bankLink.js";

/**
 * Work that runs on a schedule rather than because somebody clicked.
 *
 * Until now transactions only arrived when the sync button was pressed, which
 * makes every other figure in the app as current as the last time its owner
 * remembered. Vercel's cron calls this once a day; nothing else does.
 *
 * Not behind `requireAuth` — there is no session on a scheduled invocation, by
 * definition. The guard is a shared secret instead, and it is a real guard:
 * without it, anyone who found the URL could make this deployment hammer the
 * bank API on every account it holds.
 */
export const cronRouter = Router();

/**
 * Whether this request really came from the schedule.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on a cron invocation.
 * Unset in local dev, where the route is simply open — there is nothing behind
 * it there but a sandbox database, and requiring a secret to test it would
 * mean it never got tested.
 */
export function authorised(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return header === `Bearer ${secret}`;
}

cronRouter.get("/sync", async (req, res) => {
  if (!authorised(req.headers.authorization)) {
    res.status(401).json({ error: "not authorised" });
    return;
  }

  const accounts = await linkedAccounts();
  const results: { account: string; synced?: number; error?: string }[] = [];

  // Sequential, deliberately. These are calls to a bank API on behalf of one
  // household, not a workload — and a burst of parallel requests is the kind
  // of thing a provider rate-limits, which would turn a slow sync into a
  // failed one.
  for (const account of accounts) {
    try {
      const { synced, incomplete } = await syncAccount(account.id, account.user_id, {}, { transactionId, cleanRemittanceInfo });
      await recordSyncAttempt(account.id, incomplete ?? null);
      results.push({ account: account.name, synced, ...(incomplete ? { incomplete } : {}) });
    } catch (err) {
      // One bank's expired authorisation must not stop the others. The error
      // is recorded against that account and the loop carries on.
      const message = err instanceof Error ? err.message : "sync failed";
      console.error(`Scheduled sync failed for account ${account.id}:`, err);
      await recordSyncAttempt(account.id, message);
      results.push({ account: account.name, error: message });
    }
  }

  res.json({ accounts: accounts.length, results });
});
