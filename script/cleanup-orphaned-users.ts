import { db } from "../server/db";
import { sql } from "drizzle-orm";

/**
 * One-off cleanup script: removes orphaned user rows left over from the
 * Replit-OIDC -> Google OAuth migration.
 *
 * Background:
 *   The `users` table is keyed by the IdP `sub`. After switching from
 *   Replit OIDC to Google OAuth, rows whose `id` is an old Replit `sub`
 *   are stale. `upsertUser` already migrates rows in-place on next Google
 *   login (it conflicts on `email` and rewrites `id`), so any row whose
 *   email is not in `authorized_users` is a true orphan that will never
 *   be reclaimed.
 *
 * Behaviour:
 *   - Default: dry-run. Prints the rows that would be deleted.
 *   - Pass `--apply` to actually delete them.
 *
 * Usage:
 *   tsx script/cleanup-orphaned-users.ts          # dry-run
 *   tsx script/cleanup-orphaned-users.ts --apply  # perform deletion
 */
async function main() {
  const apply = process.argv.includes("--apply");

  const orphans = await db.execute(sql`
    SELECT u.id, u.email, u.created_at, u.updated_at
    FROM users u
    WHERE u.email IS NULL
       OR LOWER(u.email) NOT IN (
            SELECT LOWER(email) FROM authorized_users
          )
    ORDER BY u.updated_at NULLS FIRST
  `);

  const rows = orphans.rows as Array<{
    id: string;
    email: string | null;
    created_at: Date | null;
    updated_at: Date | null;
  }>;

  console.log(`Found ${rows.length} orphaned user row(s).`);
  for (const r of rows) {
    console.log(
      `  id=${r.id}  email=${r.email ?? "<null>"}  updated_at=${r.updated_at?.toISOString() ?? "<null>"}`
    );
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to delete these rows.");
    return;
  }

  if (rows.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await db.execute(sql`
    DELETE FROM users
    WHERE email IS NULL
       OR LOWER(email) NOT IN (
            SELECT LOWER(email) FROM authorized_users
          )
  `);
  console.log(`Deleted ${result.rowCount ?? 0} row(s).`);
}

main().catch((err) => {
  console.error("cleanup-orphaned-users failed:", err);
  process.exit(1);
});
