/**
 * What to show a person when a request failed.
 *
 * `api/client.ts` already unwraps the server's `{ error }` body, so a thrown
 * Error's message is the sentence the route wrote — "An account with this
 * email already exists", not `409: {"error":"..."}`. This only supplies a
 * fallback for the cases that carry no message at all: a network failure, or a
 * crash with no JSON body.
 *
 * It used to live three times over, each copy slicing at the first ": " to get
 * past a status prefix that no longer exists. Against a plain sentence that
 * slice found nothing, dropped the first character, failed to parse, and fell
 * through to the generic text — so the specific wording was lost exactly where
 * it mattered most, on sign-up and sign-in errors.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
