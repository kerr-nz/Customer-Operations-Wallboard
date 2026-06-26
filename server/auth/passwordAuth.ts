import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";

import { db } from "../db";
import { users, type User } from "@shared/models/auth";
import { eq, sql } from "drizzle-orm";

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
      // Authorization gate: only listed emails may sign in, except on a fresh
      // fork with no users yet (first sign-in bootstraps to admin).
      const countResult = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::int AS count FROM authorized_users`
      );
      const hasAuthorizedUsers = Number((countResult.rows[0] as any)?.count ?? 0) > 0;

      if (hasAuthorizedUsers) {
        const authResult = await db.execute(
          sql`SELECT 1 FROM authorized_users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`
        );
        if (authResult.rows.length === 0) {
          return res.status(403).json({ message: "This email is not authorized to sign in." });
        }
      }

      let user = await getUserByEmail(email);

      if (user?.passwordHash) {
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          return res.status(401).json({ message: "Incorrect email or password." });
        }
      } else {
        // First sign-in for this email: set the password now (register/claim).
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
            .values({ email, passwordHash })
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
