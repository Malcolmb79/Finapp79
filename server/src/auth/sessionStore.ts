import session from "express-session";
import { db } from "../db/client.js";

/**
 * express-session's default MemoryStore explicitly warns it's not fit for
 * production and leaks memory — and doesn't survive a serverless function
 * being torn down between invocations either. This backs sessions with the
 * same Postgres database as everything else instead of adding a separate
 * session-store dependency (e.g. Redis).
 *
 * expires_at is compared against an ISO string computed here in application
 * code, not a DB-side NOW()/datetime('now') — both sides of every
 * comparison are always in the exact same format this way, regardless of
 * which driver (pglite locally, real Postgres in prod) is behind db/client.ts.
 */
export class SqliteSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at > ?")
      .get<{ data: string }>(sid, new Date().toISOString())
      .then((row) => callback(null, row ? JSON.parse(row.data) : null))
      .catch((err) => callback(err));
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    const maxAgeMs = sessionData.cookie.maxAge ?? 1000 * 60 * 60 * 24 * 7;
    const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
    db.prepare(
      `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
    )
      .run(sid, JSON.stringify(sessionData), expiresAt)
      .then(() => {
        // Cheap, non-blocking cleanup instead of a setInterval (which
        // wouldn't survive a serverless function tearing down between
        // invocations) — roughly 1 in 100 writes also sweeps expired rows.
        if (Math.random() < 0.01) pruneExpiredSessions().catch(() => {});
        callback?.();
      })
      .catch((err) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    db.prepare("DELETE FROM sessions WHERE sid = ?")
      .run(sid)
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    const maxAgeMs = sessionData.cookie.maxAge ?? 1000 * 60 * 60 * 24 * 7;
    const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
    db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?")
      .run(expiresAt, sid)
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}

export async function pruneExpiredSessions(): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}
