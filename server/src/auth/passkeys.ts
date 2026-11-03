import { db } from "../db/client.js";

/**
 * Passkey (WebAuthn) credentials.
 *
 * The design follows the one already running in theultracyclist: discoverable
 * keys, no `allowCredentials` at sign-in, the counter written back on every
 * use, and a human label so a lost device can be identified and removed.
 *
 * Two things differ, both because this app is not that one. Credentials belong
 * to a row in `users` rather than to an allowlisted email address, since this
 * app is multi-user. And the challenge lives in the session rather than in a
 * signed cookie: that project runs on serverless functions with no shared
 * memory and had to carry the challenge itself, whereas `express-session` here
 * is already backed by Postgres, so the challenge can simply be put down and
 * picked up again — single-use, server-side, and expiring with the session.
 */

export interface StoredCredential {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

/** What the management UI needs. Deliberately not the key material. */
export interface CredentialSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The relying party: the site a credential is bound to.
 *
 * RP ID is the registrable domain with no scheme or port, and a credential
 * registered against one RP ID cannot be used from another. That is why
 * passkeys don't work from Vercel preview URLs, and why moving to a custom
 * domain later invalidates every credential registered against the old one.
 *
 * Derived from CLIENT_URL when not set explicitly, so local dev needs no extra
 * configuration. In dev that gives rpID `localhost` and origin
 * `http://localhost:5173` — the browser only ever talks to the Vite origin, so
 * that is the origin the authenticator will report, not the API's port.
 */
export function relyingParty(): { rpID: string; origin: string; rpName: string } | null {
  const rpName = "Personal Finance";
  const configuredId = process.env.PASSKEY_RP_ID?.trim();
  const configuredOrigin = process.env.PASSKEY_ORIGIN?.trim();

  if (configuredId) {
    return { rpID: configuredId, origin: configuredOrigin || `https://${configuredId}`, rpName };
  }

  const clientUrl = configuredOrigin || process.env.CLIENT_URL?.trim();
  if (!clientUrl) return null;

  try {
    const url = new URL(clientUrl);
    return { rpID: url.hostname, origin: url.origin, rpName };
  } catch {
    return null;
  }
}

/** Whether passkeys can work at all right now — see relyingParty(). */
export function passkeysConfigured(): boolean {
  return relyingParty() !== null;
}

export async function listForUser(userId: string): Promise<CredentialSummary[]> {
  const rows = (await db
    .prepare("SELECT id, label, created_at, last_used_at FROM passkey_credentials WHERE user_id = ? ORDER BY created_at")
    .all(userId)) as unknown as { id: string; label: string; created_at: string; last_used_at: string | null }[];

  return rows.map((row) => ({ id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
}

/**
 * The one lookup not scoped by user: at sign-in there is no session yet to say
 * who is asking, and the credential ID is what identifies the account.
 */
export async function findById(id: string): Promise<StoredCredential | undefined> {
  return db.prepare("SELECT * FROM passkey_credentials WHERE id = ?").get<StoredCredential>(id);
}

export async function addCredential(credential: {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  label: string;
}): Promise<void> {
  // Re-registering the same authenticator replaces rather than duplicates it,
  // so the list stays a list of devices rather than of registration attempts.
  await db
    .prepare(
      `INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, label)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         public_key = EXCLUDED.public_key,
         counter = EXCLUDED.counter,
         transports = EXCLUDED.transports,
         label = EXCLUDED.label`
    )
    .run(
      credential.id,
      credential.userId,
      credential.publicKey,
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      credential.label
    );
}

/** Moves the counter forward and records the use. */
export async function touchCredential(id: string, counter: number): Promise<void> {
  await db
    .prepare("UPDATE passkey_credentials SET counter = ?, last_used_at = (now() AT TIME ZONE 'utc')::text WHERE id = ?")
    .run(counter, id);
}

export async function removeCredential(id: string, userId: string): Promise<number> {
  const result = await db.prepare("DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes;
}

/** Transports come back from the column as JSON text, or not at all. */
export function parseTransports(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((t) => typeof t === "string") ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether removing this credential would leave the account with no way in.
 *
 * theultracyclist guards the same hazard with a PASSKEY_ONLY flag; here it is
 * derived from the account itself, which is better because it cannot fall out
 * of step with reality. An account that still has a password can shed its last
 * passkey freely — there is another door. One that never had a password cannot,
 * because for it the last passkey *is* the account.
 */
export function wouldLockOut(remainingCredentials: number, passwordHash: string | null): boolean {
  return remainingCredentials === 0 && !passwordHash;
}
