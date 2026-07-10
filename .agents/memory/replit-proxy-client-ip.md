---
name: Replit proxy trust for real client IP
description: How to resolve the true visitor IP behind Replit's proxy chain (for IP allowlists, rate limits, etc.)
---

# Resolving the real client IP on Replit

Replit fronts every app with SEVERAL internal proxy hops, not one. A real request
arrives with `X-Forwarded-For: <realClientIp>, 10.x.x.x, 127.0.0.1` and
`socket.remoteAddress = 127.0.0.1`. So `trust proxy = 1` (single hop) resolves the
client IP to `127.0.0.1` — an internal proxy — never the visitor. This silently
breaks any IP allowlist / view-gate.

**Fix:** trust the whole internal chain by subnet, not by hop count:
`["loopback", "linklocal", "uniquelocal"]` (proxy-addr presets; `uniquelocal`
covers 10/8, 172.16/12, 192.168/16). `proxyaddr(req, TRUSTED_PROXIES)` then walks
left past every private/loopback hop and returns the first PUBLIC address = the
real client. Apply it in BOTH places and keep them identical:
- `app.set("trust proxy", ["loopback","linklocal","uniquelocal"])` (Express, for `req.secure`/X-Forwarded-Proto)
- the shared `getClientIp()` helper used by HTTP handlers AND raw WS upgrade requests.

**Why subnet, not a hop count:** the number of internal hops is not guaranteed
stable across dev/deploy, and counting hops is fragile. Trusting private ranges is
also spoof-resistant: a client cannot forge a PUBLIC IP past the trusted internal
chain, and any XFF entry it injects lands to the LEFT of the genuine client and is
ignored.

**How to debug:** temporarily log `getClientIp(req)`, `req.headers["x-forwarded-for"]`,
and `req.socket.remoteAddress` in the access-probe endpoint, then hit it from a real
browser (curl over localhost won't reproduce the multi-hop XFF). Note: `/tmp/logs`
snapshots only update when logs are refreshed; grep the newest file after a refresh.
