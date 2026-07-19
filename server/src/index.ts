import "dotenv/config";
import cors from "cors";
import express from "express";
import { accountsRouter } from "./routes/accounts.js";
import { bankLinkRouter } from "./routes/bankLink.js";
import { categoriesRouter } from "./routes/categories.js";
import { importCsvRouter } from "./routes/importCsv.js";
import { transactionsRouter } from "./routes/transactions.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/transactions", transactionsRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/import/csv", importCsvRouter);
app.use("/api/bank-link", bankLinkRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
