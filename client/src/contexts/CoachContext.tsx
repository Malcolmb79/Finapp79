import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * What the page the coach is sitting on is currently showing.
 *
 * Almost everything the coach needs it looks up itself, server-side, from the
 * real rows — that is the rule, and it is what stops it quoting a figure
 * nobody can check. The exception is a page whose subject is not in the
 * database at all.
 *
 * Buy-to-let is that page. A deal being appraised is not a property anybody
 * owns; it is a set of assumptions worked through in the browser, deliberately
 * kept out of `properties` so that things nobody has bought stay out of net
 * worth. So without this the coach would be the only thing on that screen
 * unable to see the deal being discussed.
 *
 * It is passed as the user's own screen rather than as a tool result, and the
 * system prompt says so. A figure the coach read off the page is not a figure
 * it looked up, and the two should never be presented as equally checked.
 */

interface CoachContextValue {
  context: string | undefined;
  /** Pages with a model of their own publish it here; everything else ignores this. */
  setContext: (context: string | undefined) => void;
}

const CoachContext = createContext<CoachContextValue>({ context: undefined, setContext: () => {} });

export function CoachContextProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<string | undefined>(undefined);
  const setContext = useCallback((next: string | undefined) => setContextState(next), []);
  const value = useMemo(() => ({ context, setContext }), [context, setContext]);
  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>;
}

export function useCoachContext() {
  return useContext(CoachContext);
}
