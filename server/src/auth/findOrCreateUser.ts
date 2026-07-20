import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  email_verified_at: string | null;
}

async function getUser(id: string): Promise<AppUser> {
  return (await db.prepare("SELECT id, email, name, avatar_url, email_verified_at FROM users WHERE id = ?").get(id)) as AppUser;
}

/**
 * Resolves an OAuth callback profile to an app user, creating one if this
 * is the first time this identity has signed in.
 *
 * Two cases, in order:
 * 1. This (provider, providerUserId) has signed in before -> return that user.
 * 2. Otherwise -> a user with this email already exists (linking a second
 *    provider to the same person), or a brand new user is created.
 */
export async function findOrCreateUser(
  provider: "google" | "facebook",
  providerUserId: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null
): Promise<AppUser> {
  const existingIdentity = await db
    .prepare("SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?")
    .get<{ user_id: string }>(provider, providerUserId);

  if (existingIdentity) {
    return getUser(existingIdentity.user_id);
  }

  const userId =
    (email ? (await db.prepare("SELECT id FROM users WHERE email = ?").get<{ id: string }>(email))?.id : undefined) ?? randomUUID();

  await db
    .prepare("INSERT INTO users (id, email, name, avatar_url) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
    .run(userId, email, name, avatarUrl);
  await db
    .prepare("INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (?, ?, ?)")
    .run(userId, provider, providerUserId);

  // Arriving here at all means the OAuth provider vouched for this email —
  // that's just as good a proof of ownership as clicking a verification
  // link, so mark it verified now (COALESCE so an earlier verification
  // timestamp, e.g. from local signup, is never overwritten).
  await db
    .prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
    .run(new Date().toISOString(), userId);

  return getUser(userId);
}

export async function getUserByEmail(email: string): Promise<(AppUser & { password_hash: string | null }) | undefined> {
  return db.prepare("SELECT id, email, name, avatar_url, password_hash FROM users WHERE email = ?").get(email) as Promise<
    (AppUser & { password_hash: string | null }) | undefined
  >;
}

export async function createLocalUser(email: string, name: string | null, passwordHash: string): Promise<AppUser> {
  const userId = randomUUID();
  await db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)").run(userId, email, name, passwordHash);
  return getUser(userId);
}
