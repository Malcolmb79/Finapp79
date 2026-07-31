import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { setRequestAccountScope } from "../api/client.js";
import type { DateRange } from "../utils/dateRange.js";

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
const RANGE_KEY = "finapp.dateRange";

const DateRangeContext = createContext<{ range: DateRange; setRange: Dispatch<SetStateAction<DateRange>> }>({
  range: "all",
  setRange: () => {},
});

/**
 * The two filters that scope what is on screen: which account, and over what
 * period. Held together because they are read together — every page that
 * narrows by one narrows by the other.
 */
export function AccountScopeProvider({ children }: { children: ReactNode }) {
  // Kept across reloads: a filter that silently resets makes the figures look
  // like they changed on their own. The header always shows what's in force,
  // so a remembered filter is visible rather than a trap.
  const [scope, setScope] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // Set during render, not in an effect: a request fired by a page rendering
  // in the same commit would otherwise go out under the previous filter and
  // come back with figures for the wrong set of accounts.
  setRequestAccountScope(scope);

  const [range, setRange] = useState<DateRange>(() => (localStorage.getItem(RANGE_KEY) as DateRange | null) ?? "all");

  useEffect(() => {
    if (scope) localStorage.setItem(STORAGE_KEY, scope);
    else localStorage.removeItem(STORAGE_KEY);
  }, [scope]);

  useEffect(() => {
    localStorage.setItem(RANGE_KEY, range);
  }, [range]);

  return (
    <AccountScopeContext.Provider value={{ scope, setScope }}>
      <DateRangeContext.Provider value={{ range, setRange }}>{children}</DateRangeContext.Provider>
    </AccountScopeContext.Provider>
  );
}

/**
 * The period the figures on screen cover.
 *
 * Only ever read by figures describing a period. Balances and net worth read
 * the full history whatever this says — see withinRange.
 */
export function useDateRange() {
  return useContext(DateRangeContext);
}

export function useAccountScope() {
  return useContext(AccountScopeContext);
}
