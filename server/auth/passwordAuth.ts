import { randomBytes, createHash, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";

import { db } from "../db";
import { users, type User } from "@shared/models/auth";
import { eq, sql } from "drizzle-orm";
import { sendEmail } from "../replitmail";

const scrypt = promisify(_scrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function getSession() {
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: SESSION_TTL_MS,
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
      maxAge: SESSION_TTL_MS,
    },
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const hashBuf = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  if (hashBuf.length !== derived.length) return false;
  return timingSafeEqual(hashBuf, derived);
}

// Trusted canonical base URL for links in outbound emails. Never derived from
// request headers. Priority: explicit APP_BASE_URL → first REPLIT_DOMAINS
// entry (production deployment) → REPLIT_DEV_DOMAIN (workspace dev).
function getTrustedBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const deployed = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (deployed) return `https://${deployed}`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}`;
  return null;
}

async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${email})`);
  return user;
}

// Build the session user with the same `claims` shape the rest of the app expects.
function buildSessionUser(user: User) {
  return {
    claims: {
      sub: user.id,
      email: user.email,
      given_name: user.firstName,
      family_name: user.lastName,
      picture: user.profileImageUrl,
    },
    expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // Email + password sign-in. On a user's first sign-in (no password set yet)
  // the password they submit becomes their password — this keeps the admin
  // user-management screen unchanged (admins only add an email + role).
  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    try {
      // Authorization gate: presence in the users table = authorized. The only
      // exception is a fresh install with no users yet, where the first sign-in
      // bootstraps the first admin.
      const countResult = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM users`
      );
      const isBootstrap = Number((countResult.rows[0] as any)?.count ?? 0) === 0;

      let user = await getUserByEmail(email);

      if (!isBootstrap && !user) {
        return res.status(403).json({ message: "This email is not authorized to sign in." });
      }

      if (user?.passwordHash) {
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          return res.status(401).json({ message: "Incorrect email or password." });
        }
      } else {
        // No password yet: set it now. Either an admin-added user signing in for
        // the first time, or the very first user (bootstrap) who becomes admin.
        const passwordHash = await hashPassword(password);
        if (user) {
          [user] = await db
            .update(users)
            .set({ passwordHash, updatedAt: new Date() })
            .where(eq(users.id, user.id))
            .returning();
        } else {
          [user] = await db
            .insert(users)
            .values({ email, passwordHash, role: "admin" })
            .returning();
        }
      }

      const sessionUser = buildSessionUser(user!);
      req.logIn(sessionUser as any, (loginErr) => {
        if (loginErr) {
          console.error("[auth] Session login error:", loginErr);
          return res.status(500).json({ message: "Failed to create session." });
        }
        return res.json({ ok: true });
      });
    } catch (err) {
      console.error("[auth] Login error:", err);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Forgot-password: always respond with the same neutral message so the
  // endpoint never reveals whether an email is registered.
  const NEUTRAL_MESSAGE =
    "If your email address is found in our database, a password reset link will be sent to your email.";

  app.post("/api/auth/forgot-password", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    // Respond immediately; do the work in the background so response timing
    // doesn't leak whether the email exists.
    res.json({ message: NEUTRAL_MESSAGE });

    try {
      const user = await getUserByEmail(email);
      if (!user) return;

      // Basic per-user throttle: skip if a token was issued in the last 60s.
      const recent = await db.execute(
        sql`SELECT 1 FROM password_reset_tokens WHERE user_id = ${user.id} AND created_at > NOW() - INTERVAL '60 seconds' LIMIT 1`
      );
      if (recent.rows.length > 0) {
        console.warn(`[auth] Reset request throttled for user ${user.id}`);
        return;
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.execute(
        sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (${user.id}, ${tokenHash}, NOW() + INTERVAL '1 hour')`
      );

      // Never build the reset link from request headers (Host is attacker
      // controlled — host header injection could leak the token). Use a
      // trusted base URL from the environment only.
      const baseUrl = getTrustedBaseUrl();
      if (!baseUrl) {
        console.error(
          "[auth] Cannot send password reset email: no trusted base URL configured (set APP_BASE_URL, or run on Replit where REPLIT_DOMAINS/REPLIT_DEV_DOMAIN are provided)."
        );
        return;
      }
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      await sendEmail({
        to: email,
        subject: "Reset your password",
        text: `We received a request to reset your password.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
        html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Set a new password</a> (link is valid for 1 hour).</p><p>If you didn't request this, you can safely ignore this email.</p>`,
      });
      console.log(`[auth] Password reset email sent to user ${user.id}`);
    } catch (err) {
      console.error("[auth] Failed to process password reset request:", err);
    }
  });

  // Complete the reset: validate token, set new password, mark token used,
  // and destroy any active sessions for that user.
  app.post("/api/auth/reset-password", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or has expired." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      // Atomically claim the token (single-use) if it's valid and unexpired.
      const claimed = await db.execute<{ user_id: string }>(
        sql`UPDATE password_reset_tokens SET used = true WHERE token_hash = ${tokenHash} AND used = false AND expires_at > NOW() RETURNING user_id`
      );
      const userId = (claimed.rows[0] as any)?.user_id;
      if (!userId) {
        return res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or has expired." });
      }

      const passwordHash = await hashPassword(password);
      const [updated] = await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) {
        return res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or has expired." });
      }

      // Invalidate any other outstanding reset tokens for this user.
      await db.execute(
        sql`UPDATE password_reset_tokens SET used = true WHERE user_id = ${userId} AND used = false`
      );

      // Destroy all active sessions belonging to this user.
      await db.execute(
        sql`DELETE FROM sessions WHERE sess->'passport'->'user'->'claims'->>'sub' = ${userId}`
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error("[auth] Password reset error:", err);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  const handleLogout: RequestHandler = (req, res) => {
    req.logout((logoutErr) => {
      if (logoutErr) {
        console.error("[auth] Logout error:", logoutErr);
      }
      req.session?.destroy(() => {
        if (req.method === "POST") {
          return res.json({ ok: true });
        }
        res.redirect("/");
      });
    });
  };

  app.get("/api/auth/logout", handleLogout);
  app.post("/api/auth/logout", handleLogout);
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
