import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePlaidLink, type PlaidLinkOnExit, type PlaidLinkOnSuccess } from "react-plaid-link";
import { api } from "../api/client.js";

const LINK_TOKEN_KEY = "plaid_link_token";

type Status = "resuming" | "linking" | "syncing" | "done" | "error";

// Reached when Plaid Link redirects back here mid-flow for an OAuth
// institution (basically every UK/EU bank). Re-initializing Link with the
// same token it was created with, plus receivedRedirectUri, resumes the
// exact session the user left — it isn't a fresh code/state exchange the
// way Enable Banking's callback was.
export default function BankLinkCallback() {
  const [status, setStatus] = useState<Status>("resuming");
  const [error, setError] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState(0);
  const [linkToken] = useState(() => sessionStorage.getItem(LINK_TOKEN_KEY));

  const onSuccess: PlaidLinkOnSuccess = async (publicToken, metadata) => {
    if (!metadata.institution) {
      setError("Couldn't determine which bank was selected — start again from the Link a bank page.");
      setStatus("error");
      return;
    }
    setStatus("linking");
    try {
      const { linkedAccounts } = await api.exchangePublicToken(publicToken, metadata.institution.institution_id);
      setStatus("syncing");
      let total = 0;
      for (const accountId of linkedAccounts) {
        const { synced } = await api.syncAccount(accountId);
        total += synced;
      }
      sessionStorage.removeItem(LINK_TOKEN_KEY);
      setSyncedCount(total);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  const onExit: PlaidLinkOnExit = (plaidError) => {
    if (plaidError) {
      setError(plaidError.display_message || plaidError.error_message);
      setStatus("error");
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
    receivedRedirectUri: window.location.href,
  });

  useEffect(() => {
    if (linkToken && ready) open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!linkToken)
    return (
      <div className="card">
        <p>Missing link session. Start again from the Link a bank page.</p>
        <Link to="/bank-link">Try again</Link>
      </div>
    );
  if (status === "resuming" || status === "linking") return <div className="card">Finishing up the bank link...</div>;
  if (status === "syncing") return <div className="card">Pulling transactions from your bank...</div>;
  if (status === "error")
    return (
      <div className="card">
        <p>Something went wrong: {error}</p>
        <Link to="/bank-link">Try again</Link>
      </div>
    );

  return (
    <div className="card">
      <p>Bank linked. Imported {syncedCount} transactions.</p>
      <Link to="/transactions">View transactions</Link>
    </div>
  );
}
