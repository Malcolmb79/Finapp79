import cors from "cors";
import express from "express";
import session from "express-session";
import passport from "./auth/passport.js";
import { SqliteSessionStore } from "./auth/sessionStore.js";
import { initDb } from "./db/client.js";
import { accountsRouter } from "./routes/accounts.js";
import { authRouter } from "./routes/auth.js";
import { bankLinkRouter } from "./routes/bankLink.js";
import { budgetsRouter } from "./routes/budgets.js";
import { categoriesRouter } from "./routes/categories.js";
import { debtsRouter } from "./routes/debts.js";
import { importCsvRouter } from "./routes/importCsv.js";
import { savingsRouter } from "./routes/savings.js";
import { transactionsRouter } from "./routes/transactions.js";

// Top-level await: on Vercel this re-runs once per cold start (schema.sql
// is fully idempotent — CREATE TABLE/INDEX IF NOT EXISTS throughout — so
// that's cheap and safe), and guarantees the schema exists before this
// module finishes evaluating, so no request can ever race table creation.
await initDb();

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is not set — using an insecure fallback. Everyone gets logged out on every restart, " +
      "and sessions aren't safe beyond localhost dev. Set SESSION_SECRET in .env before deploying anywhere."
  );
}

const isProduction = process.env.NODE_ENV === "production";

const app = express();

// Vercel (and Vite's dev proxy, for local dev) sits in front of this app —
// without trust proxy, Express can't tell the original request was HTTPS,
// which would make `cookie.secure` below silently drop the session cookie.
app.set("trust proxy", 1);

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
      secure: isProduction,
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

export default app;
