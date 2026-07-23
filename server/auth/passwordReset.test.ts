// Integration tests for POST /api/auth/reset-password — the shared endpoint
// behind both /reset-password (1-hour tokens) and /welcome-invite (7-day invite
// tokens). Verifies: single-use tokens, expiry enforcement, invalidation of a
// user's other outstanding tokens, session destruction, and that the new
// password works for login afterwards.
//
// Runs against the real dev database (DATABASE_URL) with the real auth routes.
// Run: npx tsx --test server/auth/passwordReset.test.ts

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "crypto";
import type { Server } from "http";
import express from "express";

import { db } from "../db";
import { sql } from "drizzle-orm";
import { setupAuth } from "./passwordAuth";

const TEST_EMAIL = `invite-test-${Date.now()}@example.test`;
let server: Server;
let baseUrl: string;
let userId: string;

async function cleanup() {
  await db.execute(
    sql`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'invite-test-%@example.test')`
  );
  await db.execute(
    sql`DELETE FROM sessions WHERE sess->'passport'->'user'->'claims'->>'email' LIKE 'invite-test-%@example.test'`
  );
  await db.execute(sql`DELETE FROM users WHERE email LIKE 'invite-test-%@example.test'`);
}

// Insert a token row exactly the way sendInviteEmail / forgot-password do,
// returning the raw (unhashed) token the emailed link would carry.
async function issueToken(interval: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.execute(
    sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (${userId}, ${tokenHash}, NOW() + ${sql.raw(`INTERVAL '${interval}'`)})`
  );
  return token;
}

async function postReset(token: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function postLogin(password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  await cleanup();
  const inserted = await db.execute<{ id: string }>(
    sql`INSERT INTO users (email, role) VALUES (${TEST_EMAIL}, 'viewer') RETURNING id`
  );
  userId = (inserted.rows[0] as any).id;

  const app = express();
  app.use(express.json());
  await setupAuth(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await cleanup();
  server?.close();
  await (db as any).$client.end();
});

test("invite token (7-day) sets password, is single-use, and new password logs in", async () => {
  const token = await issueToken("7 days");

  const first = await postReset(token, "brand-new-pass-1");
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);

  // Second submit of the same link must be rejected.
  const second = await postReset(token, "another-pass-99");
  assert.equal(second.status, 400);
  assert.equal(second.body.code, "invalid_token");

  // The password from the FIRST submit is the one that works.
  const badLogin = await postLogin("another-pass-99");
  assert.equal(badLogin.status, 401);
  const goodLogin = await postLogin("brand-new-pass-1");
  assert.equal(goodLogin.status, 200);
  assert.equal(goodLogin.body.ok, true);
});

test("expired token is rejected and does not change the password", async () => {
  const expired = await issueToken("-1 seconds");
  const res = await postReset(expired, "should-not-take-effect");
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_token");

  const login = await postLogin("should-not-take-effect");
  assert.equal(login.status, 401);
  // Password from the previous test still works.
  const stillGood = await postLogin("brand-new-pass-1");
  assert.equal(stillGood.status, 200);
});

test("token past the 7-day window is rejected (simulated old invite)", async () => {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Insert as if created 8 days ago with the standard 7-day expiry.
  await db.execute(
    sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (${userId}, ${tokenHash}, NOW() - INTERVAL '1 day', NOW() - INTERVAL '8 days')`
  );
  const res = await postReset(token, "way-too-late-pass");
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_token");
});

test("completing a reset invalidates the user's other outstanding tokens", async () => {
  const inviteToken = await issueToken("7 days"); // welcome-invite path
  const resetToken = await issueToken("1 hour"); // reset-password path

  const used = await postReset(inviteToken, "second-fresh-pass");
  assert.equal(used.status, 200);

  // The other, otherwise-valid token must now be dead.
  const other = await postReset(resetToken, "hijack-attempt-pass");
  assert.equal(other.status, 400);
  assert.equal(other.body.code, "invalid_token");

  // And marked used in the DB.
  const rows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = ${userId} AND used = false`
  );
  assert.equal(Number((rows.rows[0] as any).n), 0);
});

test("completing a reset destroys the user's active sessions", async () => {
  // Log in to create a real session row.
  const login = await postLogin("second-fresh-pass");
  assert.equal(login.status, 200);

  const beforeRows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM sessions WHERE sess->'passport'->'user'->'claims'->>'sub' = ${userId}`
  );
  assert.ok(Number((beforeRows.rows[0] as any).n) >= 1, "expected an active session before reset");

  const token = await issueToken("1 hour");
  const res = await postReset(token, "third-fresh-pass");
  assert.equal(res.status, 200);

  const afterRows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM sessions WHERE sess->'passport'->'user'->'claims'->>'sub' = ${userId}`
  );
  assert.equal(Number((afterRows.rows[0] as any).n), 0);

  const relogin = await postLogin("third-fresh-pass");
  assert.equal(relogin.status, 200);
});

test("malformed and unknown tokens are rejected", async () => {
  const malformed = await postReset("not-a-hex-token", "whatever-pass-1");
  assert.equal(malformed.status, 400);

  const unknown = await postReset(randomBytes(32).toString("hex"), "whatever-pass-1");
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "invalid_token");
});
