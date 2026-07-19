import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { LEGACY_USER_ID } from "../db/migrate.js";

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

function getUser(id: string): AppUser {
  return db.prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?").get(id) as unknown as AppUser;
}

/**
 * Resolves an OAuth callback profile to an app user, creating one if this
 * is the first time this identity has signed in.
 *
 * Three cases, in order:
 * 1. This (provider, providerUserId) has signed in before -> return that user.
 * 2. Nobody has ever claimed the pre-auth "legacy" data (see migrate.ts)
 *    -> this is the very first OAuth login this instance has ever seen, so
 *    hand the legacy user's data to whoever it is by attaching this
 *    identity to it and filling in their profile info.
 * 3. Otherwise -> a user with this email already exists (linking a second
 *    provider to the same person), or a brand new user is created.
 */
export function findOrCreateUser(
  provider: "google" | "facebook",
  providerUserId: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null
): AppUser {
  const existingIdentity = db
    .prepare("SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?")
    .get(provider, providerUserId) as { user_id: string } | undefined;

  if (existingIdentity) {
    return getUser(existingIdentity.user_id);
  }

  const legacyUser = db.prepare("SELECT id, email FROM users WHERE id = ?").get(LEGACY_USER_ID) as
    | { id: string; email: string | null }
    | undefined;

  if (legacyUser && legacyUser.email === null) {
    db.prepare("UPDATE users SET email = ?, name = ?, avatar_url = ? WHERE id = ?").run(email, name, avatarUrl, LEGACY_USER_ID);
    db.prepare("INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (?, ?, ?)").run(
      LEGACY_USER_ID,
      provider,
      providerUserId
    );
    return getUser(LEGACY_USER_ID);
  }

  const userId = email
    ? ((db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined)?.id ?? randomUUID())
    : randomUUID();

  db.prepare("INSERT OR IGNORE INTO users (id, email, name, avatar_url) VALUES (?, ?, ?, ?)").run(userId, email, name, avatarUrl);
  db.prepare("INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (?, ?, ?)").run(userId, provider, providerUserId);

  return getUser(userId);
}

export function getUserByEmail(email: string): (AppUser & { password_hash: string | null }) | undefined {
  return db.prepare("SELECT id, email, name, avatar_url, password_hash FROM users WHERE email = ?").get(email) as
    | (AppUser & { password_hash: string | null })
    | undefined;
}

/**
 * Creates a new email/password user, or — same rule as OAuth — hands the
 * unclaimed "legacy" data to this signup if nobody has claimed it yet.
 * Callers must already have verified the email isn't taken by an existing
 * user (see the /signup route), since that has a more specific error message
 * than this function would produce.
 */
export function createLocalUser(email: string, name: string | null, passwordHash: string): AppUser {
  const legacyUser = db.prepare("SELECT id, email FROM users WHERE id = ?").get(LEGACY_USER_ID) as
    | { id: string; email: string | null }
    | undefined;

  if (legacyUser && legacyUser.email === null) {
    db.prepare("UPDATE users SET email = ?, name = ?, password_hash = ? WHERE id = ?").run(email, name, passwordHash, LEGACY_USER_ID);
    return getUser(LEGACY_USER_ID);
  }

  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)").run(userId, email, name, passwordHash);
  return getUser(userId);
}
