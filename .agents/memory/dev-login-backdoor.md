---
name: Dev-only admin login backdoor
description: How to authenticate as admin in development without a password (auth-protected routes, WS, admin APIs).
---

# Dev-only admin login backdoor

In development, `GET /api/auth/dev-login` creates a valid logged-in session without a password. It is hard-disabled in production (`NODE_ENV === "production"` returns 404) — never remove that guard.

**How to apply:** When testing auth-protected pages (`/admin`, `/spoke`, team boards), admin APIs, or authenticated WebSockets, hit `curl -c cookies.txt localhost:5000/api/auth/dev-login` (or open it in the preview browser) and reuse the session cookie for subsequent requests.

Details:
- Query params: `?email=...` (defaults to `DEV_LOGIN_DEFAULT_EMAIL` env var, then first admin in `users`, then first user), `?role=admin|viewer` (defaults to the user's stored role), `?returnTo=...`.
- The email must exist in the `users` table, otherwise 404.
- Session shape mimics the real OAuth session (passport user with claims), so all middleware behaves identically.

**Why:** Dashboards/WS endpoints became auth-protected; testing repeatedly failed with 401s until using this endpoint. Avoids round-tripping through the real login flow.
