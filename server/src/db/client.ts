import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolved relative to this file (i.e. server/), not process.cwd() — the
// server can be launched with a different working directory (e.g. from the
// repo root), and DATABASE_PATH is documented as relative to server/.
const dbPath = resolve(__dirname, "../..", process.env.DATABASE_PATH ?? "./data/finance.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const schema = readFileSync(resolve(__dirname, "schema.sql"), "utf-8");
db.exec(schema);
migrate(db);

/** node:sqlite has no built-in transaction() helper like better-sqlite3; wrap manually. */
export function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
