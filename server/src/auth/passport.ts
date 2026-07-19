import passport from "passport";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import { db } from "../db/client.js";
import { findOrCreateUser, getUserByEmail, type AppUser } from "./findOrCreateUser.js";
import { verifyPassword } from "./password.js";

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
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await findOrCreateUser(
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
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await findOrCreateUser(
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

// Always registered — email/password needs no external credentials, unlike
// the OAuth strategies above.
passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await getUserByEmail(email);
      if (!user || !user.password_hash) {
        done(null, false, { message: "Incorrect email or password." });
        return;
      }
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        done(null, false, { message: "Incorrect email or password." });
        return;
      }
      const appUser: AppUser = { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url };
      done(null, appUser);
    } catch (err) {
      done(err as Error);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, (user as AppUser).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await db.prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?").get<AppUser>(id);
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

export default passport;
