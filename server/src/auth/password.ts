import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// Node's built-in scrypt, not bcrypt/argon2 — this project deliberately
// avoids dependencies that need native compilation (see node:sqlite vs.
// better-sqlite3 in CLAUDE.md); scrypt is a sound, standard choice already
// in the runtime. Stored as "salt:hash", both hex, so verification doesn't
// need a separate column.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;

  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const storedBuf = Buffer.from(hashHex, "hex");

  // timingSafeEqual throws on length mismatch rather than returning false,
  // and a hash collision from a corrupted/foreign value would have the
  // "wrong" length — treat that as "not equal" rather than letting it throw.
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}
