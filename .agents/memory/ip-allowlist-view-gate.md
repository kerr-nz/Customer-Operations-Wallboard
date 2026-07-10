---
name: IP allowlist view gate
description: The IP allowlist gates who can VIEW wallboards without logging in — it is not a webhook filter.
---

The IP allowlist is a **view gate**, not a security/webhook filter.

- Trusted networks (IP/CIDR match) may view a wallboard without logging in; everyone else must sign in. An **empty allowlist means login is required** (not allow-all).
- Three levels: Global wallboard has its own allowlist in `app_settings.spoke_ip_allowlist`; per-Company (customer) wallboards use the customer's `ip_allowlist`; Sub-wallboard/team views inherit the owning company's allowlist.
- Webhooks are NOT IP-filtered.
- Admin actions always require an admin login regardless of IP.

**Why:** an earlier model used the allowlist to filter webhooks, which was wrong for the product — allowlists exist so NOC/shared displays can show wallboards without credentials, while admin/write paths stay behind login.

**How to apply:** view-only endpoints use `canViewCustomer` (session OR customer allowlist) and the global equivalent; state-changing customer endpoints (reset, demo/*) must use `requireAuthorized` (logged-in user), NOT the allowlist — the allowlist grants viewing only, never mutations. The client probes `GET /api/access/global` and `GET /api/access/customer/:customerId` (returns `{canView, authenticated}`) via `useWallboardAccess`.

**IP resolution:** never trust the leftmost X-Forwarded-For entry (client-spoofable). Resolve the client IP with `proxy-addr` using a single-trusted-hop function to match the app's `trust proxy = 1` (set in passwordAuth.ts). Any allowlist decision (HTTP or WebSocket upgrade) must use this resolution, or an attacker can spoof an allowlisted IP and bypass login.
