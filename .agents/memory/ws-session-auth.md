---
name: WebSocket session auth on upgrade
description: How to require a logged-in session before accepting a WebSocket connection in this Express app.
---

# Authenticating WebSocket upgrades

The HTTP `app.use(getSession())` middleware does NOT run on `httpServer.on("upgrade", ...)` — raw upgrade requests bypass the Express stack. To gate WS connections behind login you must parse the session cookie yourself.

**Pattern that works:** call a fresh `getSession()` instance directly on the raw upgrade `req` with a dummy `{}` response object:

```
const wsSessionParser = getSession();
wsSessionParser(req, {} as any, () => {
  const user = (req.session as any)?.passport?.user; // passport stores it here
  // check user.claims.email, user.expires_at, then authorized_users
});
```

`express-session` only reads `req.headers.cookie` during parse and never writes to `res` before `next()`, so the empty `{}` res is safe.

**Why:** the wallboard "force login" requirement is only real if the realtime feeds are also gated, not just the HTTP endpoints. Reject unauthorized upgrades with `socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy();`.

**How to apply:** in the `upgrade` handler, first bail out (return, do nothing) for non-app paths so Vite HMR's own upgrade still works, then validate the session for `/ws/_spoke`, `/ws/:id`, `/ws/:id/team/:id` before `wss.handleUpgrade`.
