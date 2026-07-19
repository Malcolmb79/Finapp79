import { Router } from "express";
import { db, withTransaction } from "../db/client.js";
import * as gocardless from "../services/gocardless.js";

export const bankLinkRouter = Router();

bankLinkRouter.get("/institutions", async (req, res) => {
  const country = (req.query.country as string) ?? "US";
  const institutions = await gocardless.listInstitutions(country);
  res.json(institutions);
});

// Step 1: start a bank link. Returns the URL to redirect the user to.
bankLinkRouter.post("/requisitions", async (req, res) => {
  const { institution_id, institution_name } = req.body;
  if (!institution_id) {
    res.status(400).json({ error: "institution_id is required" });
    return;
  }

  const requisition = await gocardless.createRequisition(institution_id);

  db.prepare(
    `INSERT INTO bank_connections (id, institution_id, institution_name, status)
     VALUES (?, ?, ?, 'pending')`
  ).run(requisition.id, institution_id, institution_name ?? institution_id);

  res.json({ requisitionId: requisition.id, authorizationUrl: requisition.link });
});

// Step 2: after the user authorizes at their bank and is redirected back,
// resolve the linked accounts and store them.
bankLinkRouter.post("/requisitions/:id/complete", async (req, res) => {
  const requisition = await gocardless.getRequisition(req.params.id);

  if (requisition.status !== "LN" && requisition.accounts.length === 0) {
    res.status(409).json({ error: "requisition not yet linked", status: requisition.status });
    return;
  }

  const connection = db.prepare("SELECT * FROM bank_connections WHERE id = ?").get(req.params.id);
  if (!connection) {
    res.status(404).json({ error: "bank connection not found" });
    return;
  }

  db.prepare("UPDATE bank_connections SET status = 'linked' WHERE id = ?").run(req.params.id);

  const insertAccount = db.prepare(
    `INSERT OR IGNORE INTO accounts (id, bank_connection_id, name, iban, currency, source)
     VALUES (?, ?, ?, ?, ?, 'gocardless')`
  );

  for (const accountId of requisition.accounts) {
    const details = await gocardless.getAccountDetails(accountId);
    insertAccount.run(
      accountId,
      req.params.id,
      details.account.name ?? "Linked account",
      details.account.iban ?? null,
      details.account.currency
    );
  }

  res.json({ linkedAccounts: requisition.accounts });
});

// Step 3: pull transactions for a linked account and upsert them.
bankLinkRouter.post("/accounts/:accountId/sync", async (req, res) => {
  const { accountId } = req.params;
  const { transactions } = await gocardless.getAccountTransactions(accountId);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO transactions (id, account_id, booking_date, amount, currency, description, counterparty, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'gocardless')`
  );

  let synced = 0;
  withTransaction(() => {
    for (const tx of transactions.booked) {
      const result = insert.run(
        tx.transactionId,
        accountId,
        tx.bookingDate,
        Number(tx.transactionAmount.amount),
        tx.transactionAmount.currency,
        tx.remittanceInformationUnstructured ?? null,
        tx.creditorName ?? tx.debtorName ?? null
      );
      if (result.changes > 0) synced++;
    }
  });

  res.json({ synced, totalFetched: transactions.booked.length });
});
