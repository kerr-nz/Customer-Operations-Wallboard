#!/bin/bash
set -e

# Install any new dependencies pulled in by the merged task.
npm install

# NOTE: Do NOT run `drizzle-kit push` / `npm run db:push` here.
# It is interactive in this project (stalls on an unrelated users_email_unique
# truncate prompt) and stdin is closed during post-merge, so it hangs and fails.
# Schema changes are applied via idempotent raw SQL in the startup block of
# server/routes.ts, which runs automatically when the workflow restarts after
# this script. See .agents/memory/schema-migrations.md.
