import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { Account } from "../api/client.js";
import StatementImportModal from "./StatementImportModal.js";

/**
 * Statement import from the Transactions page, for when you're not already
 * looking at the account.
 *
 * This used to be a bare file input that imported the moment a file was
 * chosen — no confirmation step, and a parser that split on every comma
 * (breaking any quoted description) and required the headers to be literally
 * "date,amount,description". It now runs the same parse-and-confirm flow as
 * the per-account upload, so both paths behave identically and neither writes
 * anything until the mapping has been approved.
 */
export default function CsvImport({ accounts, onImported }: { accounts: Account[]; onImported: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [pending, setPending] = useState<{ filename: string; content: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so re-picking the same file still fires a change event.
    e.target.value = "";
    if (!file || !account) return;
    setStatus(null);
    setPending({ filename: file.name, content: await file.text() });
  }

  if (accounts.length === 0) return null;

  return (
    <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button onClick={() => fileInputRef.current?.click()}>
        <Upload size={14} />
        Import statement
      </button>
      {/* Unfiltered on purpose — see the note in Accounts.tsx: bank exports
          frequently arrive with no extension, and an accept list hides them. */}
      <input ref={fileInputRef} type="file" onChange={handleFile} style={{ display: "none" }} />
      {status && <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{status}</span>}

      {pending && account && (
        <StatementImportModal
          accountId={account.id}
          accountName={account.name}
          filename={pending.filename}
          content={pending.content}
          onClose={() => setPending(null)}
          onImported={({ imported, duplicates, brandedAs }) => {
            setPending(null);
            setStatus(
              `Imported ${imported}` +
                (duplicates > 0 ? `, skipped ${duplicates} duplicates` : "") +
                (brandedAs ? `, matched to ${brandedAs}` : "") +
                " — waiting for review."
            );
            onImported();
          }}
        />
      )}
    </div>
  );
}
