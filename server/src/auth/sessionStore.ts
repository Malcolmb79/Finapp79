import session from "express-session";
import { db } from "../db/client.js";

/**
 * express-session's default MemoryStore explicitly warns it's not fit for
 * production and leaks memory — but more importantly for local dev, it
 * doesn't survive process restarts, and tsx watch restarts constantly.
 * This backs sessions with the same SQLite file as everything else instead
 * of adding a separate session-store dependency.
 */
export class SqliteSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at > datetime('now')").get(sid) as
        | { data: string }
        | undefined;
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAgeMs = sessionData.cookie.maxAge ?? 1000 * 60 * 60 * 24 * 7;
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
      db.prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      ).run(sid, JSON.stringify(sessionData), expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    try {
      const maxAgeMs = sessionData.cookie.maxAge ?? 1000 * 60 * 60 * 24 * 7;
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
      db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
      callback?.();
    } catch {
      callback?.();
    }
  }
}

/** Sweep expired sessions periodically instead of on every request. */
export function pruneExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
