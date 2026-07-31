import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { setRequestAccountScope } from "../api/client.js";

/**
 * Which account the app is currently looking at.
 *
 * `null` means all of them, which is the normal state. Anything else is an
 * account id, and every widget on every page narrows to it — net worth,
 * spending, cash flow, the debt picture.
 *
 * This is deliberately not the same thing as hiding an account. Hiding is a
 * standing statement that an account shouldn't count towards anything; this is
 * a temporary lens, changed several times a minute and meaning nothing about
 * the account itself. Conflating them would make "look at just this card" a
 * destructive act on the other six accounts.
 */
type AccountScope = {
  scope: string | null;
  // Takes the updater form too, so a caller can drop a stale filter without
  // having to re-read the current one and race with it.
  setScope: Dispatch<SetStateAction<string | null>>;
};

const AccountScopeContext = createContext<AccountScope>({ scope: null, setScope: () => {} });

const STORAGE_KEY = "finapp.accountScope";

export function AccountScopeProvider({ children }: { children: ReactNode }) {
  // Kept across reloads: a filter that silently resets makes the figures look
  // like they changed on their own. The header always shows what's in force,
  // so a remembered filter is visible rather than a trap.
  const [scope, setScope] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // Set during render, not in an effect: a request fired by a page rendering
  // in the same commit would otherwise go out under the previous filter and
  // come back with figures for the wrong set of accounts.
  setRequestAccountScope(scope);

  useEffect(() => {
    if (scope) localStorage.setItem(STORAGE_KEY, scope);
    else localStorage.removeItem(STORAGE_KEY);
  }, [scope]);

  return <AccountScopeContext.Provider value={{ scope, setScope }}>{children}</AccountScopeContext.Provider>;
}

export function useAccountScope() {
  return useContext(AccountScopeContext);
}
