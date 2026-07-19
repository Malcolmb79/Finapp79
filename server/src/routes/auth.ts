import { Router } from "express";
import passport, { configuredProviders } from "../auth/passport.js";

export const authRouter = Router();

function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:5173";
}

authRouter.get("/providers", (_req, res) => {
  res.json(configuredProviders);
});

authRouter.get("/me", (req, res) => {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  res.json(req.user);
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
