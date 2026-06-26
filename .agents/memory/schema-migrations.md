---
name: Schema migrations on this repl
description: How to apply DB schema changes given drizzle-kit push is interactive and stalls
---

# Applying schema changes

`drizzle-kit push` is **interactive** in this project and stalls on an unrelated
`users_email_unique` prompt — so it may never apply on a fresh fork or in
automated runs. Do **not** rely on it for schema changes.

**How to apply instead:** add idempotent raw SQL to the startup block in
`server/routes.ts` (it runs once on boot). Patterns used there:
- Columns: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- Constraints: wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=...) THEN ALTER TABLE ... ADD CONSTRAINT ... END IF; END $$;`
- One-time data migrations / table drops: guard with `to_regclass('public.<table>')` so they run only while the old object still exists, and wrap multi-step destructive migrations in a transaction (`pool.connect()` + BEGIN/COMMIT/ROLLBACK).

**Why:** these run automatically and survive fresh forks where `drizzle-kit push`
would hang; the guards make them safe to re-run on every boot.
