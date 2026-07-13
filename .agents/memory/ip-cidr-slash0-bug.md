---
name: IP allowlist /0 CIDR bug + screenshot auth workaround
description: 0.0.0.0/0 never matches in the allowlist CIDR matcher; how to open a wallboard for screenshot verification
---

# /0 CIDR entries don't match

The CIDR matcher computes the mask as `~((1 << (32 - mask)) - 1)`. For `/0`, `1 << 32` wraps to `1` in JS, so the mask becomes all-ones and `0.0.0.0/0` behaves like `/32` (matches only the literal `0.0.0.0`). IPv6 CIDRs (`::/0`) are unsupported entirely — only IPv4 / IPv4-mapped addresses match.

**Why:** JS 32-bit shift semantics wrap shift counts mod 32.

**How to apply:** Never use `0.0.0.0/0` to open a wallboard; use the pair `0.0.0.0/1` + `128.0.0.0/1` instead (covers all IPv4). A follow-up task exists to fix the matcher properly.

# Screenshot-browser auth workaround

The screenshot tool's browser does NOT retain the session cookie set by `/api/auth/dev-login` (redirect lands back on the login page every time; server logs show `canView:false, authenticated:false`). To screenshot an auth-gated wallboard:

1. Temporarily PATCH the customer's `ipAllowlist` to `["0.0.0.0/1","128.0.0.0/1"]` (admin session via curl + cookie jar).
2. Verify with `GET /api/access/customer/:id` → `canView:true`.
3. Take the screenshot of the wallboard path directly (no dev-login needed).
4. Revert the allowlist to `[]` afterwards.

dev-login still works fine for curl/WS testing (needs `-H "X-Forwarded-Proto: https"` for the secure cookie).
