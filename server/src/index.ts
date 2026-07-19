import cors from "cors";
import { config } from "dotenv";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountsRouter } from "./routes/accounts.js";
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

const app = express();

app.use(cors());
app.use(express.json());

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

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
