import passport from "passport";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "../db/client.js";
import { findOrCreateUser, type AppUser } from "./findOrCreateUser.js";

/**
 * Strategies are only registered when their credentials are actually
 * configured — constructing passport-google-oauth20/passport-facebook with
 * an undefined clientID throws immediately, which would crash the whole
 * server on boot rather than just leaving that login button non-functional
 * (same reasoning as the Enable Banking integration: missing config should
 * degrade gracefully, not take down the process).
 */
export const configuredProviders = {
  google: false,
  facebook: false,
};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/api/auth/google/callback",
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = findOrCreateUser(
            "google",
            profile.id,
            profile.emails?.[0]?.value ?? null,
            profile.displayName ?? null,
            profile.photos?.[0]?.value ?? null
          );
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
  configuredProviders.google = true;
}

if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_CLIENT_ID,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = findOrCreateUser(
            "facebook",
            profile.id,
            profile.emails?.[0]?.value ?? null,
            profile.displayName ?? null,
            profile.photos?.[0]?.value ?? null
          );
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
  configuredProviders.facebook = true;
}

passport.serializeUser((user, done) => {
  done(null, (user as AppUser).id);
});

passport.deserializeUser((id: string, done) => {
  try {
    const user = db.prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?").get(id) as AppUser | undefined;
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

export default passport;
