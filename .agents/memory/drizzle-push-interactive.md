---
name: drizzle-kit push is interactive / can block
description: Why `npm run db:push` can hang and how to apply small schema changes instead
---

# `npm run db:push` (drizzle-kit) can block on a TTY prompt

`db:push` may stop and wait for an interactive choice (e.g. "You're about to add
users_email_unique unique constraint ... Do you want to truncate?"). Piping input
(`printf '\n' | npm run db:push`) does NOT reliably answer it — drizzle-kit reads
raw TTY input and just re-renders the prompt.

**Why:** the DB schema had drift (a unique constraint defined in code but missing
in the DB), so push wanted to reconcile it interactively, unrelated to the column
being added.

**How to apply:** for a small additive change (e.g. adding one column), skip the
interactive push and apply the DDL directly via the SQL tool, e.g.
`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar;`
Then continue — the Drizzle schema in `shared/models/auth.ts` already matches.
Reserve full `db:push` for when you can interact with the prompt.
