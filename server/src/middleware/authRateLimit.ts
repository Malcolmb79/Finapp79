import rateLimit from "express-rate-limit";

// Keyed by IP (express-rate-limit's default, IPv6-safe via req.ip which
// respects `trust proxy`) rather than by the submitted email/username, so
// an attacker can't dodge the limit by rotating through target accounts
// from one machine, and one bad actor can't lock a legitimate user out.

// Brute force / credential stuffing on login: generous enough that a user
// who mistypes their password a few times isn't punished, tight enough to
// make automated guessing impractical.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

// Mass account creation / signup abuse.
export const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this network. Try again later." },
});

// Forgot-password / resend-verification: these send an email per request,
// so the limit also caps how much mail one IP can trigger, not just abuse.
export const emailActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a few minutes." },
});
