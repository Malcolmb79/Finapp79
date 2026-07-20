import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/client.js";

type TokenTable = "password_reset_tokens" | "email_verification_tokens";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Returns the raw token — the only time it's ever available in plaintext, since only its hash is persisted. */
export async function createToken(table: TokenTable, userId: string, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await db.prepare(`INSERT INTO ${table} (token_hash, user_id, expires_at) VALUES (?, ?, ?)`).run(hashToken(raw), userId, expiresAt);
  return raw;
}

/** Marks the token used and returns its owning user_id, or null if it's missing/expired/already used. */
export async function consumeToken(table: TokenTable, raw: string): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const row = await db
    .prepare(`SELECT user_id FROM ${table} WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .get<{ user_id: string }>(tokenHash, new Date().toISOString());
  if (!row) return null;

  await db.prepare(`UPDATE ${table} SET used_at = ? WHERE token_hash = ?`).run(new Date().toISOString(), tokenHash);
  return row.user_id;
}
