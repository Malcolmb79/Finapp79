import cors from "cors";
import { config } from "dotenv";
import express from "express";
import session from "express-session";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import passport from "./auth/passport.js";
import { pruneExpiredSessions, SqliteSessionStore } from "./auth/sessionStore.js";
import { accountsRouter } from "./routes/accounts.js";
import { authRouter } from "./routes/auth.js";
import { bankLinkRouter } from "./routes/bankLink.js";
import { budgetsRouter } from "./routes/budgets.js";
import { categoriesRouter } from "./routes/categories.js";
import { debtsRouter } from "./routes/debts.js";
import { importCsvRouter } from "./routes/importCsv.js";
import { savingsRouter } from "./routes/savings.js";
import { transactionsRouter } from "./routes/transactions.js";

// `.env` lives at the monorepo root, not server/ — dotenv's default
// (process.cwd()) only works if you happen to launch node from the repo
// root, which npm workspaces don't (cwd is set to server/).
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is not set — using an insecure fallback. Everyone gets logged out on every restart, " +
      "and sessions aren't safe beyond localhost dev. Set SESSION_SECRET in .env before deploying anywhere."
  );
}

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json());

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET ?? "insecure-dev-only-fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // localhost dev is plain http; flip this on behind HTTPS
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use("/api/auth", authRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/debts", debtsRouter);
app.use("/api/savings", savingsRouter);
app.use("/api/import/csv", importCsvRouter);
app.use("/api/bank-link", bankLinkRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

pruneExpiredSessions();
setInterval(pruneExpiredSessions, 1000 * 60 * 60);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
