import { Router } from "express";
import { db } from "../db/client.js";
import passport, { configuredProviders } from "../auth/passport.js";
import { createLocalUser, getUserByEmail } from "../auth/findOrCreateUser.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { hashPassword } from "../auth/password.js";

export const authRouter = Router();

function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:5173";
}

authRouter.get("/providers", (_req, res) => {
  res.json(configuredProviders);
});

authRouter.post("/signup", async (req, res, next) => {
  const { email, password, name } = req.body as { email?: unknown; password?: unknown; name?: unknown };

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  if (getUserByEmail(email)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = createLocalUser(email, typeof name === "string" && name.trim() ? name.trim() : null, passwordHash);
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

authRouter.post("/login", (req, res, next) => {
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

authRouter.get("/identities", requireAuth, (req, res) => {
  const providers = (
    db.prepare("SELECT provider FROM oauth_identities WHERE user_id = ?").all(req.user!.id) as { provider: string }[]
  ).map((row) => row.provider);
  const hasPassword = !!(
    db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string | null }
  ).password_hash;
  res.json({ providers, hasPassword });
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
