import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

type Status = "linking" | "syncing" | "done" | "error";

export default function BankLinkCallback() {
  const [status, setStatus] = useState<Status>("linking");
  const [error, setError] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState(0);

  useEffect(() => {
    (async () => {
      const requisitionId = localStorage.getItem("gc_pending_requisition_id");
      if (!requisitionId) {
        setError("No pending bank link found. Start again from the Link a bank page.");
        setStatus("error");
        return;
      }

      try {
        const { linkedAccounts } = await api.completeBankLink(requisitionId);
        localStorage.removeItem("gc_pending_requisition_id");

        setStatus("syncing");
        let total = 0;
        for (const accountId of linkedAccounts) {
          const { synced } = await api.syncAccount(accountId);
          total += synced;
        }
        setSyncedCount(total);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
  }, []);

  if (status === "linking") return <p>Finishing up the bank link...</p>;
  if (status === "syncing") return <p>Pulling transactions from your bank...</p>;
  if (status === "error")
    return (
      <div>
        <p>Something went wrong: {error}</p>
        <Link to="/bank-link">Try again</Link>
      </div>
    );

  return (
    <div>
      <p>Bank linked. Imported {syncedCount} transactions.</p>
      <Link to="/transactions">View transactions</Link>
    </div>
  );
}
