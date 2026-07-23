# Setup Guide — Self-Hosted Wallboard

This guide walks you through running your own copy of the Spoke Phone Live Operations Wallboard in your own Replit account. From import to a published wallboard takes about 10 minutes.

## 1. Import the project from GitHub

1. Log in to [Replit](https://replit.com) (create an account if you don't have one).
2. Click **Create Repl** (or the **+** button).
3. Choose **Import from GitHub**.
4. Paste the repository URL provided by Spoke and click **Import**.
5. Wait for the import to finish — Replit installs dependencies automatically.

## 2. Create the database

The app needs a PostgreSQL database. Replit provides one built in:

1. In your Repl, open **Tools → Database** (PostgreSQL).
2. Click **Create a database**.
3. That's it — Replit sets the `DATABASE_URL` environment variable automatically.

All tables are created automatically the first time the app starts. You never need to run migrations by hand.

## 3. Add the required secrets

The app needs two secrets you must set yourself:

1. Open **Tools → Secrets**.
2. Add a new secret:
   - **Key:** `SESSION_SECRET`
   - **Value:** any long random string (this signs login cookies). For example, run `openssl rand -hex 32` in the Shell tab, or just type 40+ random characters.
3. Add the email secret Spoke gives you:
   - **Key:** `RESEND_API_KEY`
   - **Value:** the sending key provided by Spoke during onboarding (used for "Forgot password?" emails — see [Password reset emails](#password-reset-emails)).

If `SESSION_SECRET` (or the database) is missing, the app will refuse to start and print a clear message in the console telling you exactly what to add.

## 4. First start & first sign-in (you become the admin)

1. Click **Run**. The console should end with `serving on port 5000`.
2. Open the app preview and go to the login page.
3. Sign in with **your email address and a new password (8+ characters)**.

> **Bootstrap rule:** on a brand-new install with no users, the **first person to sign in becomes the admin**, and the password they enter becomes their password. Do this step yourself before sharing the app's URL with anyone.

After that, only emails you add in the admin screen can sign in. New users you add set their own password on their first sign-in.

## 5. Create your customer record

Your copy runs the full app, but you only need one customer record — your own company:

1. Go to **/admin**.
2. Click **Add Customer**, enter an ID (short, lowercase, no spaces — e.g. `acme`), your company name, and your timezone (used for the midnight stats reset).
3. Optionally add an **IP allowlist** (individual IPs or CIDR ranges). Anyone viewing from an allowlisted network can see the wallboard **without logging in**. Leave it empty to require login for everyone.

## 6. Get your webhook and data action URLs

In the admin screen, each customer row shows two URLs with copy buttons:

- **Webhook URL** — `https://<your-app-domain>/webhook/<customerId>`
  Configure this in Spoke Phone as the webhook destination for call events.
- **Team Call Data Action URL** — `https://<your-app-domain>/data-action/<customerId>/team-call`
  Configure this in Spoke Phone as a Data Action so queue-bound calls are attributed to the right team.

> Use the **published** domain (see step 7) in Spoke Phone, not the development preview URL — the dev URL only works while the editor is open.

## 7. Publish (deploy)

1. Click **Publish** (top right) in Replit.
2. Choose a deployment type — **Reserved VM** is recommended: the wallboard holds live WebSocket connections and in-memory call state, so it should run continuously (Autoscale deployments can idle and drop the live ticker).
3. Publish. Your app gets a stable `*.replit.app` domain (custom domains are also supported in deployment settings).
4. Deployment secrets: `SESSION_SECRET` and `DATABASE_URL` are carried into the deployment automatically; verify them in the deployment's configuration if the published app reports a missing variable.
5. Update Spoke Phone with the published webhook / data action URLs.

## Your wallboard URLs

- `/spoke` — global wallboard (requires login or allowlisted IP)
- `/admin` — admin screen (always requires an admin login)
- `/<customerId>` — your branded company dashboard
- `/<customerId>/teams` — team board
- `/<customerId>/team/<teamId>` — per-team wallboard
- `/<customerId>/group/<groupSlug>` — sub-wallboard for a team group

## Password reset emails

The "Forgot password?" flow sends reset links through [Resend](https://resend.com), using an API key from **Spoke's** Resend account. You do **not** need your own Resend account or any domain verification:

- During onboarding, Spoke creates a **sending-only API key** for you and provides it. Paste it into your Secrets as `RESEND_API_KEY` (step 3 above).
- If the key is ever compromised or needs replacing, contact Spoke — your key can be revoked and reissued individually without affecting anyone else.
- Reset emails are sent from Spoke's configured sender address. Tell users to check spam the first time.
- If `RESEND_API_KEY` is missing, the app still runs, but reset emails won't send — the console logs a clear error while the "Forgot password?" page shows its usual neutral message.

Admins can also reset any user's password from the admin screen (the user then sets a new password on their next sign-in), so email is never the only recovery path.

## Troubleshooting

- **App won't start, console mentions a missing environment variable** — follow the instruction printed in the console (usually: add `SESSION_SECRET` in Secrets, or create the PostgreSQL database).
- **Login loop / can't stay signed in** — make sure you're accessing the app over HTTPS (the Replit preview and published URLs always are).
- **No data on the wallboard** — verify the webhook URL in Spoke Phone points at your **published** domain and includes your customer ID.
- **Getting updates** — see [UPDATING.md](./UPDATING.md).
