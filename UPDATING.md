# Updating Your Wallboard Copy

Spoke maintains the master codebase and publishes updates to the GitHub repository. Your copy pulls those updates manually — nothing changes on your app until you pull and republish.

## How to update

1. Open your Repl in Replit.
2. Open the **Git pane** (Tools → Git).
3. Click **Pull** to fetch the latest version from GitHub.
4. The app in the workspace restarts automatically with the new code. Check the console shows it starting cleanly (`serving on port 5000`).
5. Click **Publish → Republish** so your live (deployed) wallboard picks up the update.

That's it. Your data is safe during updates:

- **Database changes are automatic.** Any new tables or columns a release needs are created automatically the next time the app starts. You never run migrations yourself, and existing data (users, customers, daily stats) is preserved.
- **Your settings live in the database, not in the code** — customers, teams, groups, users, timezones, IP allowlists, and branding all survive updates untouched.
- **Secrets are untouched.** `SESSION_SECRET` and `DATABASE_URL` stay as they are.

## Do not edit the code locally

Please treat the code as read-only:

- **All configuration belongs in the admin screen or in Secrets** (environment variables). There is nothing you need to change in the code to run your copy.
- If you edit files locally, your next **Pull** can hit **merge conflicts**, which block the update until resolved by hand — and local edits may be overwritten or leave your copy in a broken half-updated state.
- If you need a change (a feature, a fix, different behavior), ask Spoke — it will land in the master repo and reach everyone through the normal update flow.

If you have already made local edits and Pull reports a conflict, the safest path is usually to discard local changes (Git pane → discard) and pull again. If in doubt, contact Spoke before clicking anything destructive.

## After updating

- Glance at the console for errors on startup.
- Open your wallboard and confirm live data still flows (make or simulate a call).
- If the published app misbehaves after a republish, check the deployment logs from the Publish pane and contact Spoke with the error text.
