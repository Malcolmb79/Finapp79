import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createPasskeyUser, getUserByEmail, getUserById, isSignupAllowed } from "../auth/findOrCreateUser.js";
import {
  addCredential,
  findById,
  listForUser,
  parseTransports,
  passkeySignInPossible,
  passkeysConfigured,
  relyingParty,
  removeCredential,
  touchCredential,
  wouldLockOut,
} from "../auth/passkeys.js";
import { loginRateLimit, signupRateLimit } from "../middleware/authRateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Passkey registration and sign-in.
 *
 * This is the one router not mounted wholly behind `requireAuth`, and it has
 * to be: signing in cannot require already being signed in. Each route below
 * states its own rule instead, and the two that write a credential both take
 * the account from the session challenge rather than from the request body —
 * so a verify can only ever finish the ceremony it was issued for.
 */

export const passkeysRouter = Router();

/** User verification is "preferred", so don't then demand it at verify time. */
const USER_VERIFICATION = "preferred" as const;

/** Passport's req.login is callback-shaped; these routes are async. */
function login(req: import("express").Request, user: Express.User): Promise<void> {
  return new Promise((resolve, reject) => {
    req.login(user, (err) => (err ? reject(err) : resolve()));
  });
}

function unavailable(res: import("express").Response) {
  res.status(503).json({
    error: "Passkeys are not configured on this server — PASSKEY_RP_ID or CLIENT_URL needs to be set.",
  });
}

/** Whether this server can do passkeys at all, so the client can hide the UI. */
/**
 * What the login page needs to decide what to offer.
 *
 * `available` is whether this server can do passkeys at all; `exclusive` is
 * whether it should now be the only thing offered — true once a passkey
 * exists, so the other methods retire themselves rather than needing a flag
 * set by hand at exactly the right moment.
 */
passkeysRouter.get("/available", async (_req, res) => {
  res.json({ available: passkeysConfigured(), exclusive: await passkeySignInPossible() });
});

/**
 * Start registration.
 *
 * Two ways in. With a session, this adds a device to the account already
 * signed in. Without one, it creates an account from the email given — the
 * same door POST /auth/signup already opens, behind the same limiter, because
 * otherwise the first passkey could never be registered at all.
 */
passkeysRouter.post("/register/options", signupRateLimit, async (req, res, next) => {
  const rp = relyingParty();
  if (!rp) return unavailable(res);

  try {
    let userId: string;
    let userName: string;

    if (req.isAuthenticated?.() && req.user) {
      userId = req.user.id;
      userName = req.user.email ?? req.user.id;
    } else {
      const email = (req.body as { email?: unknown }).email;
      if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
        res.status(400).json({ error: "Enter a valid email address." });
        return;
      }
      const existing = await getUserByEmail(email);
      if (existing) {
        // Deliberately not "that email is taken": adding a passkey to an
        // existing account has to go through signing in to it first, or a
        // passkey would be a way to take over an account by knowing its
        // address.
        res.status(409).json({ error: "An account with this email already exists — sign in first, then add a passkey in Settings." });
        return;
      }
      if (!isSignupAllowed(email)) {
        res.status(403).json({ error: "Sign-ups are closed." });
        return;
      }
      const user = await createPasskeyUser(email, null);
      userId = user.id;
      userName = email;
    }

    const existing = await listForUser(userId);
    const stored = await Promise.all(existing.map((c) => findById(c.id)));

    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName,
      userDisplayName: userName,
      // Stops the same authenticator registering twice, which would read as
      // two devices and give false confidence about how many ways back in
      // there are.
      excludeCredentials: stored
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({ id: c.id, transports: parseTransports(c.transports) })),
      authenticatorSelection: { residentKey: "required", userVerification: USER_VERIFICATION },
    });

    req.session.passkeyChallenge = { challenge: options.challenge, userId };
    res.json(options);
  } catch (err) {
    next(err);
  }
});

passkeysRouter.post("/register/verify", async (req, res, next) => {
  const rp = relyingParty();
  if (!rp) return unavailable(res);

  const pending = req.session.passkeyChallenge;
  // Cleared whatever happens below, so a challenge is never usable twice.
  delete req.session.passkeyChallenge;

  if (!pending?.userId) {
    res.status(400).json({ error: "Registration timed out — start again." });
    return;
  }

  try {
    const { response, label } = req.body as { response?: unknown; label?: unknown };
    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      // Matches the "preferred" asked for above: demanding it here would
      // reject an authenticator that did exactly what it was asked.
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: "Could not verify that passkey." });
      return;
    }

    const { credential } = verification.registrationInfo;
    await addCredential({
      id: credential.id,
      userId: pending.userId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
      label: (typeof label === "string" && label.trim()) || "Passkey",
    });

    // A registration that created the account also signs it in, so the flow
    // ends on the dashboard rather than back at a login form asking the user
    // to prove again what they just proved.
    if (!req.isAuthenticated?.()) {
      const user = await getUserById(pending.userId);
      if (user) await login(req, user);
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

passkeysRouter.post("/authenticate/options", async (req, res, next) => {
  const rp = relyingParty();
  if (!rp) return unavailable(res);

  try {
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      // No allowCredentials on purpose: discoverable keys let the
      // authenticator offer the right passkey without the site first
      // revealing which credentials exist for an address.
      userVerification: USER_VERIFICATION,
    });
    req.session.passkeyChallenge = { challenge: options.challenge };
    res.json(options);
  } catch (err) {
    next(err);
  }
});

passkeysRouter.post("/authenticate/verify", loginRateLimit, async (req, res, next) => {
  const rp = relyingParty();
  if (!rp) return unavailable(res);

  const pending = req.session.passkeyChallenge;
  delete req.session.passkeyChallenge;

  if (!pending) {
    res.status(400).json({ error: "Sign-in timed out — try again." });
    return;
  }

  try {
    const { response } = req.body as { response?: { id?: string } };
    const credentialId = response?.id;
    const stored = typeof credentialId === "string" ? await findById(credentialId) : undefined;
    if (!stored) {
      res.status(401).json({ error: "That passkey isn't registered." });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.public_key, "base64url")),
        counter: Number(stored.counter),
        transports: parseTransports(stored.transports) as never,
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: "Could not verify that passkey." });
      return;
    }

    await touchCredential(stored.id, verification.authenticationInfo.newCounter);

    // The credential names the account; the request body never does.
    const user = await getUserById(stored.user_id);
    if (!user) {
      res.status(401).json({ error: "That passkey's account no longer exists." });
      return;
    }
    await login(req, user);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

passkeysRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    res.json(await listForUser(req.user!.id));
  } catch (err) {
    next(err);
  }
});

passkeysRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const remaining = (await listForUser(req.user!.id)).filter((c) => c.id !== id);
    const account = req.user!.email ? await getUserByEmail(req.user!.email) : undefined;

    if (wouldLockOut(remaining.length, account?.password_hash ?? null)) {
      res.status(409).json({
        error: "That's the only way into this account. Add another passkey, or set a password, before removing it.",
      });
      return;
    }

    const changes = await removeCredential(id, req.user!.id);
    if (changes === 0) {
      res.status(404).json({ error: "passkey not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
