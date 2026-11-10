import type { AppUser } from "./findOrCreateUser.js";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AppUser {}
  }
}

declare module "express-session" {
  interface SessionData {
    /**
     * The in-flight WebAuthn challenge, between the "options" call and the
     * "verify" call that answers it.
     *
     * In the session rather than a cookie because this app has a real session
     * store; it is single-use and cleared on both success and failure, so a
     * challenge can never be replayed. `userId` is carried alongside for
     * registration, so a verify can only ever write a credential for the
     * account the options were issued to — not one named by the request body.
     */
    passkeyChallenge?: { challenge: string; userId?: string };

    /**
     * Whose finances are being looked at, when that is not your own.
     *
     * In the session rather than a per-request parameter so it survives a
     * page load and cannot be set by a link somebody is sent. It grants
     * nothing on its own: `resolveScope` re-checks the share against the
     * database on every single request, so a stale or forged value simply
     * falls back to your own data.
     */
    viewingUserId?: string;
  }
}
