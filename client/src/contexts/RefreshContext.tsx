import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * A signal that the figures behind the chrome have changed.
 *
 * The sidebar sits outside the router, so it mounts once and keeps whatever it
 * fetched. That is fine for a page that only reads, and wrong the moment a page
 * writes: change what a policy contributes and the card says one thing while
 * the net worth two inches to its left says another, until the next full
 * reload. Two totals disagreeing on screen is worse than either being briefly
 * stale, because there is no way to tell which one to believe.
 *
 * Deliberately a counter rather than the data itself. A shared store would mean
 * every page reading its figures from one place — a much larger change, and one
 * that would have to answer what happens when two pages disagree about how to
 * derive them. A counter says only "what you have is old", and each consumer
 * refetches whatever it already knows how to fetch.
 *
 * A page calls `refresh()` after it writes; anything that reads puts `version`
 * in its effect's dependencies.
 */

const RefreshContext = createContext<{ version: number; refresh: () => void }>({ version: 0, refresh: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  // Stable across renders, so putting it in an effect's dependencies doesn't
  // make that effect fire on every render.
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh() {
  return useContext(RefreshContext);
}
