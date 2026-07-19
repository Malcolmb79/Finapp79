import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Two drivers behind one interface, chosen by whether POSTGRES_URL is set:
 *  - Set (Vercel deployment) -> @neondatabase/serverless, talking to real
 *    Vercel Postgres over the network (this is what @vercel/postgres wraps
 *    — now deprecated in favor of using it directly, since Vercel Postgres
 *    moved to a native Neon integration).
 *  - Unset (local dev) -> @electric-sql/pglite, a WASM Postgres that runs
 *    in-process with zero external service or native build step — same
 *    "no required install for local dev" principle that picked node:sqlite
 *    over better-sqlite3 originally, just aimed at a Postgres-compatible
 *    engine now that production needs real Postgres.
 * Both speak the same SQL dialect (Postgres), so there's no behavioral
 * split between dev and prod beyond which one happens to be talking over a
 * socket.
 */
interface QueryResultLike {
  rows: unknown[];
  rowCount?: number | null;
  affectedRows?: number;
}

type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResultLike>;

interface Driver {
  query: QueryFn;
  exec(text: string): Promise<void>;
  // A dedicated connection for the lifetime of `fn`, so every query inside
  // it (BEGIN, the statements, COMMIT/ROLLBACK) hits the same physical
  // connection — critical for a pooled driver, where plain `query()` calls
  // may otherwise be multiplexed across different connections and BEGIN on
  // one wouldn't cover an INSERT issued on another.
  transaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T>;
}

async function createDriver(): Promise<Driver> {
  if (process.env.POSTGRES_URL) {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    return {
      query: (text, params) => pool.query(text, params),
      exec: async (text) => {
        await pool.query(text);
      },
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn((text, params) => client.query(text, params));
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = resolve(__dirname, "../../data/pgdata");
  const pg = await PGlite.create(dataDir);
  return {
    query: (text, params) => pg.query(text, params),
    exec: async (text) => {
      await pg.exec(text);
    },
    // pglite is a single in-process instance (no connection pool to worry
    // about), so its own .transaction() — which handles begin/commit/
    // rollback based on whether the callback throws — is sufficient.
    transaction: (fn) => pg.transaction((tx) => fn((text, params) => tx.query(text, params))),
  };
}

// One driver instance for the process's lifetime — a serverless invocation
// creates it once on cold start and every query in that invocation reuses
// it; local dev creates it once at boot, same as the old node:sqlite handle.
let driverPromise: Promise<Driver> | null = null;
function getDriver(): Promise<Driver> {
  if (!driverPromise) driverPromise = createDriver();
  return driverPromise;
}

// The rest of the app was written against node:sqlite's `db.prepare(sql).get/all/run(...params)`
// shape with `?` placeholders. Rather than rewrite every call site's SQL to
// Postgres's `$1, $2, ...` style, this shim translates placeholders once
// here and keeps the exact same call shape everywhere else — the only
// change every call site needed was adding `await`, not restructuring the
// query itself.
function toPositional(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

function makeStatement(query: QueryFn, text: string) {
  const positional = toPositional(text);
  return {
    async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
      const { rows } = await query(positional, params);
      return rows[0] as T | undefined;
    },
    async all<T = unknown>(...params: unknown[]): Promise<T[]> {
      const { rows } = await query(positional, params);
      return rows as T[];
    },
    async run(...params: unknown[]): Promise<{ changes: number }> {
      const result = await query(positional, params);
      return { changes: result.rowCount ?? result.affectedRows ?? 0 };
    },
  };
}

export const db = {
  prepare(text: string) {
    // Deferred: getDriver() resolves lazily on first use inside the
    // returned statement's get/all/run, not here, so prepare() itself
    // stays synchronous (matching every call site's existing shape).
    return makeStatement(async (t, p) => (await getDriver()).query(t, p), text);
  },
  async exec(text: string): Promise<void> {
    const driver = await getDriver();
    await driver.exec(text);
  },
};

export interface TxHandle {
  prepare(text: string): ReturnType<typeof makeStatement>;
}

export async function withTransaction<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
  const driver = await getDriver();
  return driver.transaction((query) => fn({ prepare: (text) => makeStatement(query, text) }));
}

export async function initDb(): Promise<void> {
  const schema = readFileSync(resolve(__dirname, "schema.sql"), "utf-8");
  await db.exec(schema);
}
