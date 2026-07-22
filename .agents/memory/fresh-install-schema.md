---
name: Fresh-install schema bootstrap
description: How self-hosted copies get a working schema on an empty database
---
Rule: a startup schema-bootstrap module must create every table idempotently BEFORE the session store (connect-pg-simple has createTableIfMissing:false) and before the incremental ALTER-based startup migrations run — otherwise a fresh empty DB fails on first boot.

**Why:** customers import the repo into their own Replit accounts with an empty database; drizzle-kit push is interactive and can't run unattended, so nothing else creates tables.

**How to apply:** whenever a startup migration adds a column/table, mirror it in the bootstrap module so fresh installs match the live schema. Verify by cold-starting against a scratch database (CREATE DATABASE off the main DATABASE_URL) inside a single shell session — background servers do not survive across separate shell invocations here, so start the server, curl, and kill it in one command. Secure session cookies require an `X-Forwarded-Proto: https` header when testing with curl over localhost.
