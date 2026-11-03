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
  }
}
