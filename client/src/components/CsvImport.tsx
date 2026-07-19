import { useState } from "react";
import { api, type Account } from "../api/client.js";

/** Expects a CSV with a header row: date,amount,description */
export default function CsvImport({ accounts, onImported }: { accounts: Account[]; onImported: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accountId) return;

    const text = await file.text();
    const [header, ...lines] = text.trim().split("\n");
    const columns = header.split(",").map((c) => c.trim().toLowerCase());
    const dateIdx = columns.indexOf("date");
    const amountIdx = columns.indexOf("amount");
    const descIdx = columns.indexOf("description");

    const rows = lines.map((line) => {
      const cells = line.split(",");
      return {
        date: cells[dateIdx]?.trim(),
        amount: Number(cells[amountIdx]),
        description: descIdx >= 0 ? cells[descIdx]?.trim() : undefined,
      };
    });

    const result = await api.importCsv(accountId, rows);
    setStatus(`Imported ${result.imported}, skipped ${result.skipped} duplicates.`);
    onImported();
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input type="file" accept=".csv" onChange={handleFile} />
      {status && <p>{status}</p>}
    </div>
  );
}
