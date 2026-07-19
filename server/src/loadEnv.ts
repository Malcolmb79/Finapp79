import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Must be the first import in index.ts (or any other entrypoint), not just
 * the first line of code in it. ES module imports execute in declaration
 * order, all of them, before the importing module's own top-level body
 * runs — so if `config()` lived in index.ts's body, every module index.ts
 * imports (passport.ts, db/client.ts, ...) would already have executed and
 * read `process.env` before their values were ever set. Observed directly:
 * passport.ts's `if (process.env.GOOGLE_CLIENT_ID ...)` module-level check
 * always evaluated false — even with GOOGLE_CLIENT_ID correctly set in
 * .env — until this file existed and was imported ahead of everything else.
 *
 * `.env` lives at the monorepo root, not server/ — dotenv's default
 * (process.cwd()) only works if you happen to launch node from the repo
 * root, which npm workspaces don't (cwd is set to server/).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
