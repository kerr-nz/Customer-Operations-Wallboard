import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./passwordAuth";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function getSafeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const { passwordHash: _passwordHash, ...safeUser } = user;

      // Surface the signed-in user's role so non-admin pages can branch on it
      // without hitting an admin-only endpoint. Mirrors the bootstrap rule:
      // on a fresh install with no authorized users yet, the user is admin.
      let role: "admin" | "viewer" | null = null;
      const countResult = await pool.query("SELECT COUNT(*) FROM authorized_users");
      const hasUsers = parseInt(countResult.rows[0].count, 10) > 0;
      if (!hasUsers) {
        role = "admin";
      } else if (user.email) {
        const roleResult = await pool.query(
          "SELECT role FROM authorized_users WHERE LOWER(email) = LOWER($1) LIMIT 1",
          [user.email]
        );
        role = roleResult.rows[0]?.role === "admin" ? "admin" : roleResult.rows[0] ? "viewer" : null;
      }

      res.json({ ...safeUser, role });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // DEV ONLY — production guard must not be removed
  app.get("/api/auth/dev-login", async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }

    // Resolve email: explicit param → env var default → first admin in authorized_users → first user in users table
    let email = (req.query.email as string | undefined) || process.env.DEV_LOGIN_DEFAULT_EMAIL;
    if (!email) {
      const firstAdmin = await pool.query(
        "SELECT email FROM authorized_users WHERE role = 'admin' ORDER BY created_at LIMIT 1"
      );
      if (firstAdmin.rows[0]?.email) {
        email = firstAdmin.rows[0].email;
      } else {
        const firstUser = await pool.query(
          "SELECT email FROM users WHERE email IS NOT NULL ORDER BY created_at LIMIT 1"
        );
        email = firstUser.rows[0]?.email ?? "admin@example.com";
      }
    }

    const roleParam = req.query.role as string | undefined;
    const returnTo = getSafeReturnTo(req.query.returnTo);

    // Look up user by email in the users table
    const [dbUser] = await db.select().from(users).where(eq(users.email, email));
    if (!dbUser) {
      return res.status(404).json({ message: `User with email '${email}' not found in users table` });
    }

    // Look up role from authorized_users
    const authResult = await pool.query(
      "SELECT role FROM authorized_users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );
    const storedRole: "admin" | "viewer" =
      authResult.rows[0]?.role === "admin" ? "admin" : "viewer";

    // Validate role param; fall back to stored role
    const validRoles = ["admin", "viewer"] as const;
    const role: "admin" | "viewer" =
      roleParam && (validRoles as readonly string[]).includes(roleParam)
        ? (roleParam as "admin" | "viewer")
        : storedRole;

    // Build session user matching real OAuth session shape
    const sessionUser = {
      claims: {
        sub: dbUser.id,
        email: dbUser.email,
        given_name: dbUser.firstName,
        family_name: dbUser.lastName,
        picture: dbUser.profileImageUrl,
      },
      access_token: "dev-token",
      expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      role,
    };

    (req.session as any).passport = { user: sessionUser };
    req.session.save((err) => {
      if (err) {
        console.error("[dev-login] Session save error:", err);
        return res.status(500).json({ message: "Failed to create session" });
      }
      console.log(`[dev-login] Logged in as ${email} (role: ${role}) → ${returnTo}`);
      return res.redirect(returnTo);
    });
  });
}
