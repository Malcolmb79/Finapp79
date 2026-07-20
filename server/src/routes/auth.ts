import { Router } from "express";
import { db } from "../db/client.js";
import passport, { configuredProviders } from "../auth/passport.js";
import { createLocalUser, getUserByEmail } from "../auth/findOrCreateUser.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { loginRateLimit, signupRateLimit, emailActionRateLimit } from "../middleware/authRateLimit.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createToken, consumeToken } from "../auth/tokens.js";
import { sendEmail } from "../services/mailer.js";
import { passwordResetEmail, oauthOnlyAccountEmail, verifyEmailEmail } from "../auth/emailTemplates.js";

export const authRouter = Router();

const ONE_HOUR_MS = 1000 * 60 * 60;
const ONE_DAY_MS = ONE_HOUR_MS * 24;

const PROVIDER_LABEL: Record<string, string> = { google: "Google", facebook: "Facebook" };

function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:5173";
}

async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = await createToken("email_verification_tokens", userId, ONE_DAY_MS);
  // Verification link points at the API (not a client route) since it just
  // needs to consume the token and redirect — no client-side page needed.
  // `/api` is same-origin in production and proxied to the API by Vite in
  // dev (see vite.config.ts), so clientUrl() is correct in both cases.
  await sendEmail({ to: email, ...verifyEmailEmail(`${clientUrl()}/api/auth/verify-email?token=${token}`) });
}

authRouter.get("/providers", (_req, res) => {
  res.json(configuredProviders);
});

authRouter.post("/signup", signupRateLimit, async (req, res, next) => {
  const { email, password, name } = req.body as { email?: unknown; password?: unknown; name?: unknown };

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  if (await getUserByEmail(email)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await createLocalUser(email, typeof name === "string" && name.trim() ? name.trim() : null, passwordHash);

    // Best-effort: a broken mail provider shouldn't block account creation,
    // since the user can always ask for the verification email again later.
    sendVerificationEmail(user.id, email).catch((err) => console.error("Failed to send verification email:", err));

    req.login(user, (err) => {
      if (err) {
        next(err);
        return;
      }
      res.status(201).json(user);
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginRateLimit, (req, res, next) => {
  passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message?: string } | undefined) => {
    if (err) {
      next(err);
      return;
    }
    if (!user) {
      res.status(401).json({ error: info?.message ?? "Incorrect email or password." });
      return;
    }
    req.login(user, (loginErr) => {
      if (loginErr) {
        next(loginErr);
        return;
      }
      res.json(user);
    });
  })(req, res, next);
});

authRouter.get("/me", (req, res) => {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  res.json(req.user);
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name can't be empty." });
    return;
  }
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.trim(), req.user!.id);
  const updated = await db.prepare("SELECT id, email, name, avatar_url, email_verified_at FROM users WHERE id = ?").get(req.user!.id);
  res.json(updated);
});

authRouter.post("/password", requireAuth, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }

  const row = (await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id)) as { password_hash: string | null };

  try {
    // Users who signed up via OAuth have no password_hash yet — this both
    // sets their first password and changes an existing one, so no current-
    // password check applies unless they already have one to verify against.
    if (row.password_hash) {
      if (typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, row.password_hash))) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
    }
    const newHash = await hashPassword(newPassword);
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/identities", requireAuth, async (req, res) => {
  const providers = (
    (await db.prepare("SELECT provider FROM oauth_identities WHERE user_id = ?").all(req.user!.id)) as { provider: string }[]
  ).map((row) => row.provider);
  const hasPassword = !!(
    (await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id)) as { password_hash: string | null }
  ).password_hash;
  res.json({ providers, hasPassword });
});

// Deliberately always responds the same way regardless of whether the email
// belongs to an account — a different response would let an attacker use
// this endpoint to enumerate registered emails.
authRouter.post("/forgot-password", emailActionRateLimit, async (req, res, next) => {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || !email) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  try {
    const user = await getUserByEmail(email);
    if (user) {
      if (user.password_hash) {
        const token = await createToken("password_reset_tokens", user.id, ONE_HOUR_MS);
        await sendEmail({ to: email, ...passwordResetEmail(`${clientUrl()}/reset-password?token=${token}`) });
      } else {
        const providers = (
          (await db.prepare("SELECT provider FROM oauth_identities WHERE user_id = ?").all(user.id)) as { provider: string }[]
        ).map((row) => PROVIDER_LABEL[row.provider] ?? row.provider);
        await sendEmail({ to: email, ...oauthOnlyAccountEmail(providers.join(" or ") || "a connected account") });
      }
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  const { token, newPassword } = req.body as { token?: unknown; newPassword?: unknown };

  if (typeof token !== "string" || !token) {
    res.status(400).json({ error: "Missing reset token." });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const userId = await consumeToken("password_reset_tokens", token);
    if (!userId) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }
    const newHash = await hashPassword(newPassword);
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Reached by clicking the link in the verification email — a GET request
// with no client-side page of its own, so it redirects back into the app
// with a query param the client reads to show a confirmation.
authRouter.get("/verify-email", async (req, res, next) => {
  const token = req.query.token;
  try {
    const userId = typeof token === "string" ? await consumeToken("email_verification_tokens", token) : null;
    if (userId) {
      await db
        .prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
        .run(new Date().toISOString(), userId);
    }
    res.redirect(`${clientUrl()}/?emailVerified=${userId ? "1" : "0"}`);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/resend-verification", requireAuth, emailActionRateLimit, async (req, res, next) => {
  try {
    const user = (await db.prepare("SELECT email, email_verified_at FROM users WHERE id = ?").get(req.user!.id)) as {
      email: string | null;
      email_verified_at: string | null;
    };
    if (!user.email || user.email_verified_at) {
      res.status(204).send();
      return;
    }
    await sendVerificationEmail(req.user!.id, user.email);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      next(err);
      return;
    }
    res.status(204).send();
  });
});

for (const provider of ["google", "facebook"] as const) {
  authRouter.get(`/${provider}`, (req, res, next) => {
    if (!configuredProviders[provider]) {
      res.redirect(`${clientUrl()}/login?error=${provider}_not_configured`);
      return;
    }
    passport.authenticate(provider, { scope: provider === "google" ? ["profile", "email"] : ["email"] })(req, res, next);
  });

  authRouter.get(
    `/${provider}/callback`,
    (req, res, next) => {
      if (!configuredProviders[provider]) {
        res.redirect(`${clientUrl()}/login?error=${provider}_not_configured`);
        return;
      }
      passport.authenticate(provider, { failureRedirect: `${clientUrl()}/login?error=${provider}_failed` })(req, res, next);
    },
    (_req, res) => {
      res.redirect(clientUrl());
    }
  );
}
