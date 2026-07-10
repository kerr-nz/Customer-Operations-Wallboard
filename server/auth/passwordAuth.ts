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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getCompanyName(): Promise<string> {
  try {
    const result = await db.execute(
      sql`SELECT value FROM app_settings WHERE key = 'app_company_name' LIMIT 1`
    );
    const value = (result.rows[0] as { value?: string } | undefined)?.value?.trim();
    if (value && value !== "Your Company Name") return value;
  } catch (err) {
    console.error("[auth] Failed to load company name for email branding:", err);
  }
  return "Spoke Phone";
}

function buildResetEmailHtml(companyName: string, resetUrl: string): string {
  const safeName = escapeHtml(companyName);
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#0b0f1a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 20px 32px;border-bottom:1px solid #1f2937;">
              <div style="font-size:20px;font-weight:bold;color:#f9fafb;letter-spacing:0.5px;">${safeName}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:2px;">Live Operations Wallboard</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <h1 style="margin:0 0 16px 0;font-size:18px;color:#f9fafb;">Reset your password</h1>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#d1d5db;">We received a request to reset the password for your ${safeName} wallboard account. Click the button below to choose a new password.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="border-radius:8px;background-color:#22d3ee;">
                    <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:bold;color:#0b0f1a;text-decoration:none;border-radius:8px;">Set a new password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#9ca3af;">This link is valid for 1 hour. If the button doesn't work, copy and paste this URL into your browser:</p>
              <p style="margin:0 0 20px 0;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${resetUrl}" style="color:#22d3ee;text-decoration:underline;">${resetUrl}</a></p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">If you didn't request this, you can safely ignore this email — your password will stay the same.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #1f2937;">
              <p style="margin:0;font-size:12px;color:#6b7280;">${safeName} &middot; Live call activity dashboard</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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
      // The wallboard is viewed inside the Replit workspace/canvas iframe, a
      // cross-site context. Cookies are only sent from a cross-site iframe when
      // they are SameSite=None + Secure; SameSite=Lax cookies are silently
      // dropped there, which breaks the login/session (endless redirect to the
      // login page). Replit always serves over HTTPS (trust proxy is set), so
      // Secure cookies work in both the dev workspace and production.
      secure: true,
      sameSite: "none",
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

      const companyName = await getCompanyName();
      await sendEmail({
        to: email,
        subject: `${companyName} — Reset your password`,
        text: `We received a request to reset the password for your ${companyName} wallboard account.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.\n\n— ${companyName}`,
        html: buildResetEmailHtml(companyName, resetUrl),
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
