import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL("https://accounts.google.com"),
      process.env.GOOGLE_CLIENT_ID!,
      { client_secret: process.env.GOOGLE_CLIENT_SECRET! }
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  const claims = tokens.claims();
  user.claims = claims;
  user.access_token = tokens.access_token;
  // Local session expiry: 1 week from login (independent of Google token lifetime).
  user.expires_at = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["given_name"],
    lastName: claims["family_name"],
    profileImageUrl: claims["picture"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      const claims = tokens.claims() as any;
      if (claims?.email_verified !== true) {
        console.warn("[auth] Rejected login: email not verified", { email: claims?.email });
        return verified(null, false, { message: "Email not verified" });
      }
      const user = {};
      updateUserSession(user, tokens);
      try {
        await upsertUser(claims);
      } catch (dbErr) {
        console.error("[auth] Non-critical: failed to upsert user record:", dbErr);
      }
      verified(null, user);
    } catch (err) {
      console.error("[auth] Verify error:", err);
      verified(err as Error);
    }
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `googleauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile",
          callbackURL: `https://${domain}/api/auth/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/auth/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`googleauth:${req.hostname}`, {
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
    })(req, res, next);
  });

  app.get("/api/auth/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`googleauth:${req.hostname}`, (err: any, user: any, info: any) => {
      if (err) {
        console.error("[auth] Callback error:", err);
        return res.redirect("/api/auth/login");
      }
      if (!user) {
        console.error("[auth] Callback no user, info:", info);
        return res.redirect("/api/auth/login");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("[auth] Session login error:", loginErr);
          return res.redirect("/api/auth/login");
        }
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/auth/logout", (req, res) => {
    req.logout((logoutErr) => {
      if (logoutErr) {
        console.error("[auth] Logout error:", logoutErr);
      }
      req.session?.destroy(() => {
        res.redirect("/");
      });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at) {
    const now = Math.floor(Date.now() / 1000);
    if (now > user.expires_at) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  return next();
};
