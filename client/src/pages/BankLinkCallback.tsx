import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

type Status = "linking" | "syncing" | "done" | "error";

export default function BankLinkCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>("linking");
  const [error, setError] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState(0);

  useEffect(() => {
    (async () => {
      const authError = searchParams.get("error");
      if (authError) {
        setError(searchParams.get("error_description") ?? authError);
        setStatus("error");
        return;
      }

      const code = searchParams.get("code");
      const state = searchParams.get("state");
      if (!code || !state) {
        setError("Missing code/state in the redirect. Start again from the Link a bank page.");
        setStatus("error");
        return;
      }

      try {
        const { linkedAccounts } = await api.completeBankLink(code, state);

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
    // Read the redirect's query params once on mount; re-running this on every
    // searchParams identity change would re-exchange an already-used code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
