import type { DatabaseSync } from "node:sqlite";

/**
 * Upgrades a pre-auth database (accounts/transactions/etc. with no user_id
 * column) to the multi-user schema without losing any existing data.
 *
 * Every step here is idempotent and re-checked independently rather than
 * wrapped in one all-or-nothing transaction, because node:sqlite's ALTER
 * TABLE does not actually participate in an explicit BEGIN/ROLLBACK the way
 * plain DML does (observed directly: a mid-migration failure left ALTER'd
 * columns in place while an uncommitted INSERT/UPDATE in the same
 * transaction was rolled back). So instead of assuming atomicity this is
 * written to converge to the correct end state no matter which partial
 * state a previous crash left behind, and running it again is always safe.
 *
 * The placeholder "legacy" user (no email) owns all pre-existing data until
 * claimLegacyUser.ts hands it to whoever completes the very first OAuth
 * login — after that, logins by other people just get their own empty
 * account, as normal multi-user isolation expects.
 *
 * categories.name and budgets.category_id are special-cased: pre-auth, both
 * had an inline column-level UNIQUE constraint, which SQLite implements as
 * an autoindex that CANNOT be dropped with DROP INDEX (unlike a constraint
 * added via a separate CREATE INDEX) — the only way to change it to a
 * per-user constraint is a full table rebuild, which rebuildTable() does,
 * preserving every row. Detected by the old index's continued presence
 * (not by whether user_id already exists), since a crash can leave a table
 * with user_id added but the old constraint not yet removed.
 *
 * A brand-new database never hits any of this: schema.sql already creates
 * every table with user_id built in and no legacy single-column unique
 * indexes, so every check below is already satisfied.
 */

export const LEGACY_USER_ID = "legacy";

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function hasSingleColumnUniqueIndex(db: DatabaseSync, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string; unique: number }[];
  return indexes.some((idx) => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[];
    return cols.length === 1 && cols[0].name === column;
  });
}

function ensureUserIdColumn(db: DatabaseSync, table: string): void {
  if (!tableExists(db, table)) return;
  if (!hasColumn(db, table, "user_id")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT REFERENCES users(id)`);
  }
  db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(LEGACY_USER_ID);
}

// Renamed rather than dropped-and-recreated-in-place so a crash between the
// RENAME and the final DROP TABLE just leaves an extra `*_pre_auth` table
// instead of losing data — rerunning is safe either way, since the SELECT
// below only runs against a table that still exists at that name.
function rebuildWithoutLegacyUniqueIndex(db: DatabaseSync, table: string, createSql: string, copyColumns: string): void {
  const tmpName = `${table}_pre_auth`;
  if (!tableExists(db, tmpName)) {
    db.exec(`ALTER TABLE ${table} RENAME TO ${tmpName}`);
  }
  if (!tableExists(db, table)) {
    db.exec(createSql);
  }
  db.prepare(`INSERT INTO ${table} (${copyColumns}) SELECT ${copyColumns.replace("user_id", "?")} FROM ${tmpName}`).run(LEGACY_USER_ID);
  db.exec(`DROP TABLE ${tmpName}`);
}

export function migrate(db: DatabaseSync): void {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, NULL, ?)").run(LEGACY_USER_ID, "Unclaimed data");

  for (const table of ["bank_connections", "accounts", "transactions", "debts", "savings_goals"]) {
    ensureUserIdColumn(db, table);
  }

  if (hasSingleColumnUniqueIndex(db, "categories", "name")) {
    rebuildWithoutLegacyUniqueIndex(
      db,
      "categories",
      `CREATE TABLE categories (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id TEXT REFERENCES users(id),
         name TEXT NOT NULL,
         parent_id INTEGER REFERENCES categories(id)
       )`,
      "id, user_id, name, parent_id"
    );
  } else {
    ensureUserIdColumn(db, "categories");
  }

  if (hasSingleColumnUniqueIndex(db, "budgets", "category_id")) {
    rebuildWithoutLegacyUniqueIndex(
      db,
      "budgets",
      `CREATE TABLE budgets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id TEXT REFERENCES users(id),
         category_id INTEGER NOT NULL REFERENCES categories(id),
         monthly_limit REAL NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      "id, user_id, category_id, monthly_limit, created_at"
    );
  } else {
    ensureUserIdColumn(db, "budgets");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories (user_id, name)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category ON budgets (user_id, category_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id)");

  // Nullable: OAuth-only users never get one, and that's the normal case, not
  // a partial/invalid state.
  if (!hasColumn(db, "users", "password_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
}
