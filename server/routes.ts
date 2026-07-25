import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cron from "node-cron";
import proxyaddr from "proxy-addr";
import pg from "pg";
import { phoneToCoords } from "./geoLookup";
import {
  getTodayCalls,
  resetTenant,
  getStats,
  getGlobalStats,
  getGlobalRecentCalls,
  getPerCustomerStats,
  getAllTenantIds,
  getRecentCalls,
  loadFromDb,
  loadAllActiveCustomers,
  persistStats,
  addCall,
  getCall,
  statsNewCall,
  statsAnswer,
  statsEndCall,
  statsSentiment,
  normalizeSentiment,
  teamStatsNewCall,
  teamStatsAnswer,
  teamStatsRecordWait,
  teamStatsEndCall,
  updateTeamAvailability,
  reconcileTeamAgents,
  updateUserAvailabilityAcrossTeams,
  getTeamState,
  getAllTeamSummaries,
  getAllTeamStats,
  getTeamRecentCalls,
  getTeamStats,
  getTeamLiveWaitAvg,
  isTenantCallEnded,
  isTeamCallEnded,
  setPendingTeamAssignment,
  takePendingTeamAssignment,
  teamAttributeRingingCall,
  markTeamCallWaiting,
  teamRolloverMiss,
  statsReviveCall,
  getTeamRingStart,
  getTenantCallEndedAt,
  teamOwnsCall,
  sweepStaleCalls,
  getDriftDebug,
  SWEEP_INTERVAL_MS,
} from "./webhookState";
import type { CallData, Customer, AuthorizedUser, CustomerTeam, TeamAgent, TeamSummary } from "@shared/schema";
import { insertCustomerSchema, insertAuthorizedUserSchema } from "@shared/schema";
import { isAuthenticated, getSession, sendInviteEmail } from "./auth";
import { log } from "./index";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tenantWsClients = new Map<string, Set<WebSocket>>();
const teamWsClients = new Map<string, Set<WebSocket>>();
const globalWsClients = new Set<WebSocket>();

function teamWsKey(customerId: string, teamId: string) {
  return `${customerId}::${teamId}`;
}

function broadcast(customerId: string, event: Record<string, unknown>) {
  const msg = JSON.stringify(event);
  const clients = tenantWsClients.get(customerId);
  if (clients) {
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  const globalEvent = JSON.stringify({
    ...event,
    customerId,
    globalStats: getGlobalStats(),
  });
  globalWsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(globalEvent);
    }
  });
}

function broadcastToTeam(customerId: string, teamId: string, event: Record<string, unknown>) {
  const key = teamWsKey(customerId, teamId);
  const clients = teamWsClients.get(key);
  if (!clients) return;
  const msg = JSON.stringify(event);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

async function getCustomer(customerId: string): Promise<Customer | null> {
  const result = await pool.query("SELECT * FROM customers WHERE id = $1", [customerId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    ipAllowlist: row.ip_allowlist || [],
    timezone: row.timezone || "UTC",
    defaultRegion: row.default_region || "world",
    createdAt: row.created_at,
  };
}

async function ensureTeamInDb(customerId: string, teamId: string, teamName: string): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO customer_teams (customer_id, team_id, team_name, sla_answer_seconds) VALUES ($1, $2, $3, 15) ON CONFLICT (customer_id, team_id) DO UPDATE SET team_name = $3",
      [customerId, teamId, teamName]
    );
  } catch (err) {
    console.error(`[teams] Failed to upsert team ${teamId} for ${customerId}:`, err);
  }
}

// Resolve the real client IP using the same trust model Express is configured
// with (set in passwordAuth.ts). Replit fronts the app with SEVERAL internal
// proxy hops (loopback + private 10.x addresses), so a single-hop trust returns
// an internal proxy IP instead of the visitor. We trust all loopback/link-local/
// unique-local (private) addresses and return the first *public* address in the
// X-Forwarded-For chain — the real client. This is spoof-resistant: a client
// cannot forge a public IP past the trusted internal chain, and any XFF entry it
// injects lands to the left of the genuine client and is ignored.
// Works for both Express requests and raw http upgrade requests (WebSocket).
export const TRUSTED_PROXIES = ["loopback", "linklocal", "uniquelocal"];
function getClientIp(req: any): string {
  try {
    return proxyaddr(req, TRUSTED_PROXIES) || req.socket?.remoteAddress || "";
  } catch {
    return req.socket?.remoteAddress || "";
  }
}

// View-gating IP match. Unlike a webhook filter, an EMPTY allowlist grants
// nobody anonymous access — it means "login required". Returns true only when
// the allowlist has at least one entry AND the client IP matches one of them.
function ipMatchesAllowlist(clientIp: string, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  const normalizedIp = clientIp.replace(/^::ffff:/, "");
  for (const entry of allowlist) {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry) continue;
    if (normalizedEntry.includes("/")) {
      if (isIpInCidr(normalizedIp, normalizedEntry)) return true;
    } else {
      if (normalizedIp === normalizedEntry.replace(/^::ffff:/, "")) return true;
    }
  }
  return false;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = parseInt(bits, 10);
  if (isNaN(mask)) return false;
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  if (ipNum === null || rangeNum === null) return false;
  const maskNum = ~((1 << (32 - mask)) - 1) >>> 0;
  return (ipNum & maskNum) === (rangeNum & maskNum);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}

async function getAuthorizedUser(email: string): Promise<AuthorizedUser | null> {
  const result = await pool.query(
    "SELECT id, email, role, created_at FROM users WHERE LOWER(email) = LOWER($1)",
    [email]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

async function hasAnyAuthorizedUsers(): Promise<boolean> {
  const result = await pool.query("SELECT COUNT(*) FROM users");
  return parseInt(result.rows[0].count) > 0;
}

// The Global Wallboard's own IP allowlist, stored as a comma-separated app
// setting. Empty when unset → global wallboard requires login for anonymous IPs.
async function getGlobalAllowlist(): Promise<string[]> {
  const result = await pool.query("SELECT value FROM app_settings WHERE key = 'spoke_ip_allowlist'");
  if (result.rows.length === 0) return [];
  return String(result.rows[0].value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// True when the request carries a logged-in, authorized session. Mirrors the
// bootstrap rule used by isAuthorizedViewer: a fresh install with no users lets
// any authenticated session through.
async function isSessionAuthorized(req: any): Promise<boolean> {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.claims?.email) {
    return false;
  }
  const email = req.user.claims.email;
  const hasUsers = await hasAnyAuthorizedUsers();
  if (!hasUsers) return true;
  const authUser = await getAuthorizedUser(email);
  return !!authUser;
}

// View gate for customer-scoped wallboard endpoints (Company, Sub-wallboard,
// and team views). Access is granted when the session is authorized OR the
// client IP is in the owning company's allowlist. Admin actions never use this.
const canViewCustomer: RequestHandler = async (req: any, res, next) => {
  if (await isSessionAuthorized(req)) return next();
  const { customerId } = req.params;
  const customer = await getCustomer(customerId);
  if (customer && ipMatchesAllowlist(getClientIp(req), customer.ipAllowlist)) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};

// Requires a logged-in authorized user (any role). Used for state-changing
// customer endpoints (reset, demo simulation) that must never be reachable by
// an anonymous allowlisted viewer — the IP allowlist is a view gate only.
const requireAuthorized: RequestHandler = async (req: any, res, next) => {
  if (await isSessionAuthorized(req)) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAuthorizedAdmin: RequestHandler = async (req: any, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.claims?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const email = req.user.claims.email;
  const hasUsers = await hasAnyAuthorizedUsers();
  if (!hasUsers) {
    return next();
  }
  const authUser = await getAuthorizedUser(email);
  if (!authUser || authUser.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admin access required" });
  }
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  for (const col of [
    "inbound_total_duration",
    "inbound_duration_count",
    "outbound_total_duration",
    "outbound_duration_count",
    "avg_call_duration_inbound",
    "avg_call_duration_outbound",
  ]) {
    await pool.query(`ALTER TABLE wallboard_stats ADD COLUMN IF NOT EXISTS ${col} INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE team_daily_stats ADD COLUMN IF NOT EXISTS ${col} INTEGER NOT NULL DEFAULT 0`);
  }

  // Password reset tokens for the self-service forgot-password flow.
  // Stores only a SHA-256 hash of the token; single-use with expiry.
  await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL,
    token_hash varchar NOT NULL UNIQUE,
    expires_at timestamp NOT NULL,
    used boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id)`);

  // Ensure the password_hash column exists for email + password auth.
  // drizzle-kit push is interactive (stalls on an unrelated users_email_unique
  // prompt) so it may never apply on a fresh fork — add it idempotently here.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar`);

  // Consolidated auth model: a single `users` table where presence = authorized
  // and a `role` column (admin/viewer) replaces the separate authorized_users
  // allowlist. Add the column idempotently, then fold any legacy
  // authorized_users rows into users and drop the old table (one-time).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar NOT NULL DEFAULT 'viewer'`);
  // Guard role values at the DB level (idempotent).
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer'));
    END IF;
  END $$;`);

  const legacyAllowlist = await pool.query(`SELECT to_regclass('public.authorized_users') AS t`);
  if (legacyAllowlist.rows[0]?.t) {
    const migrationClient = await pool.connect();
    try {
      await migrationClient.query("BEGIN");
      const { rows: countRows } = await migrationClient.query("SELECT COUNT(*)::int AS c FROM authorized_users");
      const allowlistCount = countRows[0]?.c ?? 0;
      if (allowlistCount > 0) {
        // Copy roles onto matching user rows.
        await migrationClient.query(`UPDATE users u SET role = au.role FROM authorized_users au WHERE LOWER(u.email) = LOWER(au.email)`);
        // Insert allowlisted emails that don't yet have a user row (no password —
        // they'll set one on first sign-in).
        await migrationClient.query(`INSERT INTO users (email, role) SELECT LOWER(au.email), au.role FROM authorized_users au WHERE NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(au.email))`);
        // Enforce the new invariant: any user row not on the allowlist was never
        // actually authorized (e.g. stale/test rows). Only ever run this when the
        // allowlist is non-empty so an empty/corrupt legacy table can never wipe
        // legitimate users (and lock everyone out).
        await migrationClient.query(`DELETE FROM users u WHERE NOT EXISTS (SELECT 1 FROM authorized_users au WHERE LOWER(au.email) = LOWER(u.email))`);
        console.log("[migration] Consolidated authorized_users into users table");
      } else {
        console.log("[migration] Legacy authorized_users empty — dropping without touching users");
      }
      await migrationClient.query(`DROP TABLE authorized_users`);
      await migrationClient.query("COMMIT");
    } catch (migrationErr) {
      await migrationClient.query("ROLLBACK");
      throw migrationErr;
    } finally {
      migrationClient.release();
    }
  }

  await loadAllActiveCustomers();

  await pool.query("UPDATE customer_teams SET sla_answer_seconds = 15 WHERE sla_answer_seconds IS NULL");

  // Deduplicate app_settings rows before creating unique index (in case prior INSERT attempts created duplicates)
  await pool.query(`
    DELETE FROM app_settings
    WHERE ctid NOT IN (
      SELECT min(ctid) FROM app_settings GROUP BY key
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS app_settings_key_unique ON app_settings (key)`);

  // Seed default branding rows so they always exist from first boot
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('app_company_name', 'Your Company Name') ON CONFLICT (key) DO NOTHING"
  );
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('app_company_logo', '') ON CONFLICT (key) DO NOTHING"
  );

  // Clear any previously persisted invalid logo value (not a data:image/ URL) so the header
  // falls back to the phone icon instead of rendering a broken image. Idempotent.
  await pool.query(
    "UPDATE app_settings SET value = '' WHERE key = 'app_company_logo' AND value <> '' AND value NOT LIKE 'data:image/%'"
  );

  const wss = new WebSocketServer({ noServer: true });

  // Parse the session cookie on the upgrade request so wallboard WebSocket
  // connections require a logged-in, authorized session (just like the HTTP
  // wallboard endpoints). Reuses the same session store as the HTTP app.
  const wsSessionParser = getSession();

  function isWsRequestAuthorized(req: any): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        wsSessionParser(req, {} as any, async () => {
          try {
            const sessionUser = (req.session as any)?.passport?.user;
            const email = sessionUser?.claims?.email;
            if (!email) return resolve(false);
            if (
              sessionUser.expires_at &&
              Math.floor(Date.now() / 1000) > sessionUser.expires_at
            ) {
              return resolve(false);
            }
            // Bootstrap: a fresh install with no authorized users allows any
            // authenticated session; otherwise the email must be authorized.
            const hasUsers = await hasAnyAuthorizedUsers();
            if (!hasUsers) return resolve(true);
            const authUser = await getAuthorizedUser(email);
            return resolve(!!authUser);
          } catch {
            resolve(false);
          }
        });
      } catch {
        resolve(false);
      }
    });
  }

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);

    const isSpoke = url.pathname === "/ws/_spoke";
    const teamMatch = url.pathname.match(/^\/ws\/([^/]+)\/team\/([^/]+)$/);
    const custMatch = url.pathname.match(/^\/ws\/(.+)$/);

    // Only handle our known WS routes; ignore anything else (e.g. Vite HMR).
    if (!isSpoke && !teamMatch && !custMatch) return;

    // A connection is accepted when either the session is authorized OR the
    // client IP matches the relevant allowlist (Global list for `_spoke`; the
    // owning company's list for customer and team sockets).
    let authorized = await isWsRequestAuthorized(req);
    if (!authorized) {
      const clientIp = getClientIp(req as any);
      if (isSpoke) {
        authorized = ipMatchesAllowlist(clientIp, await getGlobalAllowlist());
      } else {
        const custId = teamMatch ? teamMatch[1] : custMatch![1];
        const customer = await getCustomer(custId);
        authorized = !!customer && ipMatchesAllowlist(clientIp, customer.ipAllowlist);
      }
    }
    if (!authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (isSpoke) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, "_spoke");
      });
    } else if (teamMatch) {
      const customerId = teamMatch[1];
      const teamId = teamMatch[2];
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, `team::${customerId}::${teamId}`);
      });
    } else if (custMatch) {
      const customerId = custMatch[1];
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, customerId);
      });
    }
  });

  wss.on("connection", async (ws: WebSocket, _req: any, customerId: string) => {
    if (customerId.startsWith("team::")) {
      const parts = customerId.split("::");
      const custId = parts[1];
      const tId = parts[2];
      log(`Team wallboard connected: ${custId}/team/${tId}`, "ws");

      const key = teamWsKey(custId, tId);
      if (!teamWsClients.has(key)) teamWsClients.set(key, new Set());
      teamWsClients.get(key)!.add(ws);

      const customer = await getCustomer(custId);
      if (!customer || !customer.active) {
        ws.close(4004, "Customer not found or inactive");
        return;
      }

      const teamState = getTeamState(custId, tId);
      const teamCalls = getTeamRecentCalls(custId, tId);

      let summary = teamState?.summary || null;
      if (!summary || summary.displayName === tId) {
        try {
          const dbTeam = await pool.query(
            "SELECT team_name FROM customer_teams WHERE customer_id = $1 AND team_id = $2",
            [custId, tId]
          );
          if (dbTeam.rows.length > 0 && dbTeam.rows[0].team_name) {
            const dbName = dbTeam.rows[0].team_name;
            if (summary) {
              summary = { ...summary, displayName: dbName };
            } else {
              summary = { id: tId, displayName: dbName, totalMembers: 0, totalAvailable: 0, status: "unknown", availabilitySummary: "" };
            }
          }
        } catch {}
      }

      ws.send(JSON.stringify({
        type: "team.init",
        customerId: custId,
        teamId: tId,
        customerName: customer.name,
        summary,
        agents: teamState?.agents || [],
        stats: getTeamStats(custId, tId),
        recentCalls: teamCalls,
        teams: getAllTeamSummaries(custId),
      }));

      ws.on("close", () => {
        const clients = teamWsClients.get(key);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) teamWsClients.delete(key);
        }
      });
      return;
    }

    if (customerId === "_spoke") {
      log("Global Spoke wallboard connected", "ws");
      globalWsClients.add(ws);

      const customerList = await pool.query("SELECT id, name, default_region FROM customers WHERE active = true ORDER BY name");
      const customers = customerList.rows.map((r: any) => ({ id: r.id, name: r.name, defaultRegion: r.default_region || "world" }));

      ws.send(
        JSON.stringify({
          type: "init",
          stats: getGlobalStats(),
          recentCalls: getGlobalRecentCalls(),
          perCustomerStats: getPerCustomerStats(),
          customers,
        })
      );

      ws.on("close", () => {
        globalWsClients.delete(ws);
      });
      return;
    }

    log(`Frontend connected for customer: ${customerId}`, "ws");

    if (!tenantWsClients.has(customerId)) {
      tenantWsClients.set(customerId, new Set());
    }
    tenantWsClients.get(customerId)!.add(ws);

    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      ws.close(4004, "Customer not found or inactive");
      return;
    }

    ws.send(
      JSON.stringify({
        type: "init",
        stats: getStats(customerId),
        recentCalls: getRecentCalls(customerId),
        customerName: customer.name,
        defaultRegion: customer.defaultRegion || "world",
        teams: getAllTeamSummaries(customerId),
        teamStatsMap: getAllTeamStats(customerId),
      })
    );

    ws.on("close", () => {
      const clients = tenantWsClients.get(customerId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) tenantWsClients.delete(customerId);
      }
    });
  });

  function getLocalDate(timezone: string): string {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const get = (t: string) => parts.find(p => p.type === t)?.value || "00";
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  cron.schedule("* * * * *", async () => {
    try {
      const spokeSettingsResult = await pool.query("SELECT value FROM app_settings WHERE key = 'spoke_timezone'");
      const spokeTz = spokeSettingsResult.rows.length > 0 ? spokeSettingsResult.rows[0].value : "UTC";
      const spokeLocalDate = getLocalDate(spokeTz);

      const spokeResetResult = await pool.query("SELECT value FROM app_settings WHERE key = 'spoke_last_reset_date'");
      const spokeLastReset = spokeResetResult.rows.length > 0 ? spokeResetResult.rows[0].value : null;

      let globalReset = false;
      if (!spokeLastReset || spokeLastReset < spokeLocalDate) {
        log(`Global Spoke reset (timezone: ${spokeTz}, local date: ${spokeLocalDate}, last reset: ${spokeLastReset || "never"})`, "cron");

        const allCustomers = await pool.query("SELECT id, timezone FROM customers WHERE active = true");
        for (const row of allCustomers.rows) {
          const tz = row.timezone || "UTC";
          await resetTenant(row.id, tz);
          const localDate = getLocalDate(tz);
          await pool.query("UPDATE customers SET last_reset_date = $1 WHERE id = $2", [localDate, row.id]);

          const clients = tenantWsClients.get(row.id);
          if (clients) {
            const msg = JSON.stringify({ type: "reset", stats: getStats(row.id) });
            clients.forEach((client: WebSocket) => {
              if (client.readyState === WebSocket.OPEN) client.send(msg);
            });
          }
        }

        await pool.query(
          "INSERT INTO app_settings (key, value) VALUES ('spoke_last_reset_date', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [spokeLocalDate]
        );
        globalReset = true;
      } else {
        const result = await pool.query("SELECT id, timezone, last_reset_date FROM customers WHERE active = true");

        for (const row of result.rows) {
          const tz = row.timezone || "UTC";
          const localDate = getLocalDate(tz);
          const lastReset = row.last_reset_date;

          if (lastReset && lastReset >= localDate) continue;

          log(`Midnight reset for ${row.id} (timezone: ${tz}, local date: ${localDate}, last reset: ${lastReset || "never"})`, "cron");
          await resetTenant(row.id, tz);
          await pool.query("UPDATE customers SET last_reset_date = $1 WHERE id = $2", [localDate, row.id]);

          const clients = tenantWsClients.get(row.id);
          if (clients) {
            const msg = JSON.stringify({ type: "reset", stats: getStats(row.id) });
            clients.forEach((client: WebSocket) => {
              if (client.readyState === WebSocket.OPEN) client.send(msg);
            });
          }

          const perTenantGlobalMsg = JSON.stringify({ type: "stats", globalStats: getGlobalStats() });
          globalWsClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(perTenantGlobalMsg);
          });
        }
      }

      if (globalReset) {
        const globalResetMsg = JSON.stringify({ type: "reset", globalStats: getGlobalStats() });
        globalWsClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(globalResetMsg);
        });
      }
    } catch (err) {
      console.error("[cron] Timezone reset check failed:", err);
    }
  });

  // --- Stale-call sweeper: removes entries from activeCallIds older than STALE_CALL_MS ---
  setInterval(async () => {
    try {
      const sweeps = sweepStaleCalls();
      for (const sweep of sweeps) {
        const customer = await getCustomer(sweep.customerId);
        const tz = customer?.timezone || "UTC";
        await persistStats(sweep.customerId, tz);
        const tenantStats = getStats(sweep.customerId);
        if (sweep.removedTenantCallIds.length > 0) {
          log(`[sweeper] Removed ${sweep.removedTenantCallIds.length} stale tenant calls for ${sweep.customerId}: ${sweep.removedTenantCallIds.join(",")}`, "sweeper");
          broadcast(sweep.customerId, { type: "stats.update", stats: tenantStats });
        }
        // Broadcast the force-ended call objects so connected tickers heal
        // along with the KPIs (previously only counters were healed, leaving
        // ghost "Talking" rows on every wallboard level).
        for (const endedCall of sweep.endedCalls) {
          log(`[sweeper] Force-ended stale call ${endedCall.id} (${endedCall.status}) for ${sweep.customerId}`, "sweeper");
          broadcast(sweep.customerId, { type: "call.ended", call: endedCall, stats: tenantStats });
          if (endedCall.teamId) {
            broadcastToTeam(sweep.customerId, endedCall.teamId, {
              type: "call.ended",
              call: endedCall,
              stats: getTeamStats(sweep.customerId, endedCall.teamId),
            });
          }
        }
        for (const teamId of sweep.affectedTeamIds) {
          const teamStats = getTeamStats(sweep.customerId, teamId);
          log(`[sweeper] Team ${teamId} active swept to ${teamStats.active} for ${sweep.customerId}`, "sweeper");
          broadcastToTeam(sweep.customerId, teamId, { type: "team.stats", teamId, stats: teamStats });
          broadcast(sweep.customerId, { type: "team.stats", teamId, stats: teamStats });
        }
      }
    } catch (err) {
      console.error("[sweeper] Failed:", err);
    }
  }, SWEEP_INTERVAL_MS);

  // --- Debug endpoint: active-calls drift smoking-gun stats ---
  app.get("/api/debug/active-calls-drift", (_req, res) => {
    res.json(getDriftDebug());
  });

  // --- Webhook endpoint (per-customer) ---
  app.post("/webhook/:customerId", async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // NOTE: The IP allowlist is a *view* gate for wallboards, not a webhook
    // filter. Webhook acceptance is intentionally not gated by the allowlist.

    const event = req.body;
    const eventType = event?.type;
    log(`Webhook [${customerId}]: ${eventType} (${event?.id})`, "webhook");

    const tz = customer.timezone || "UTC";
    try {
      switch (eventType) {
        case "call.started":
          await handleCallStarted(customerId, event, tz);
          break;
        case "call.answered":
          await handleCallAnswered(customerId, event, tz);
          break;
        case "call.ended":
        case "call.hungup":
          await handleCallEnded(customerId, event, tz);
          break;
        case "call.not_answered":
          await handleCallNotAnswered(customerId, event, tz);
          break;
        case "content_analysis.completed":
          handleContentAnalysis(customerId, event, tz);
          break;
        case "team.availability.updated":
          handleTeamAvailability(customerId, event);
          break;
        case "user.availability.updated":
          handleUserAvailability(customerId, event);
          break;
        default:
          log(`Unhandled event type: ${eventType}`, "webhook");
      }
    } catch (err) {
      console.error(`Error handling ${eventType} for ${customerId}:`, err);
    }

    res.status(200).json({ received: true });
  });

  // --- Team Call Data Action endpoint (per-customer) ---
  // Spoke's Team Call data action fires just before a call is offered to a
  // team queue, telling us the EXACT team the call is ringing for. This is a
  // fire-and-forget listener: we always ack immediately and never return
  // routing instructions. Internal calls are ignored. A data action arriving
  // before its call.started webhook is held briefly and applied when the call
  // appears; a repeat data action with a different team is a queue rollover
  // (missed call for the previous team, fresh ringing call for the new one).
  app.post("/data-action/:customerId/team-call", async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Ack first — Spoke's routing must never wait on (or be affected by) us.
    res.status(200).json({ received: true });

    try {
      const result = processTeamCallDataAction(customerId, customer.timezone || "UTC", req.body);
      log(`Data action [${customerId}]: ${result.status}${result.callId ? ` call=${result.callId}` : ""}${result.teamId ? ` team=${result.teamId}` : ""}`, "data-action");
    } catch (err) {
      console.error(`Error handling team-call data action for ${customerId}:`, err);
    }
  });

  // --- Health endpoint ---
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      tenants: tenantWsClients.size,
    });
  });

  // --- View-access probes (public) ---
  // Let the frontend learn whether the current visitor may VIEW a wallboard,
  // either because they are authenticated OR because their IP is allowlisted.
  // `authenticated` distinguishes a logged-in session from anonymous IP access.
  app.get("/api/access/global", async (req: any, res) => {
    const authenticated = await isSessionAuthorized(req);
    const canView = authenticated || ipMatchesAllowlist(getClientIp(req), await getGlobalAllowlist());
    res.json({ canView, authenticated });
  });

  app.get("/api/access/customer/:customerId", async (req: any, res) => {
    const authenticated = await isSessionAuthorized(req);
    let canView = authenticated;
    if (!canView) {
      const customer = await getCustomer(req.params.customerId);
      canView = !!customer && ipMatchesAllowlist(getClientIp(req), customer.ipAllowlist);
    }
    res.json({ canView, authenticated });
  });

  // --- Customer health endpoint ---
  app.get("/api/customers/:customerId/health", canViewCustomer, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({
      status: "ok",
      customer: customer.name,
      stats: getStats(customerId),
    });
  });

  // --- Customer info endpoint (for frontend branding) ---
  app.get("/api/customers/:customerId", canViewCustomer, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const settingResult = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('app_company_name', 'app_company_logo')");
    const settings: Record<string, string> = {};
    for (const row of settingResult.rows) settings[row.key] = row.value;
    const companyName = settings["app_company_name"] || "Your Company Name";
    const logoUrl = settings["app_company_logo"] || null;
    res.json({
      id: customer.id,
      name: customer.name,
      active: customer.active,
      companyName,
      logoUrl,
    });
  });

  // --- Reset endpoint (per-customer) ---
  app.post("/api/customers/:customerId/reset", requireAuthorized, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    const tz = customer?.timezone || "UTC";
    const localDate = getLocalDate(tz);
    log(`Manual reset for customer: ${customerId}`, "reset");
    await resetTenant(customerId, tz);
    await persistStats(customerId, tz);
    await pool.query("UPDATE customers SET last_reset_date = $1 WHERE id = $2", [localDate, customerId]);
    broadcast(customerId, { type: "reset", stats: getStats(customerId) });
    res.json({ status: "reset", stats: getStats(customerId) });
  });

  // --- Demo simulate (per-customer) ---
  app.post("/api/customers/:customerId/demo/simulate", requireAuthorized, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const phoneNumbers = [
      "+14155551234", "+12125559876", "+14085554321",
      "+13055558765", "+16505557654", "+12815553456",
      "+442079460000", "+61398765432", "+6421234567",
      "+441912345678", "+613987654321", "+6493216543",
    ];
    const companyNumbers = ["+18005551000", "+442012345678", "+61283456789"];

    const direction: "inbound" | "outbound" = Math.random() > 0.5 ? "inbound" : "outbound";
    const contactNum = phoneNumbers[Math.floor(Math.random() * phoneNumbers.length)];
    const companyNum = companyNumbers[Math.floor(Math.random() * companyNumbers.length)];
    const isInbound = direction === "inbound";

    const fromNum = isInbound ? contactNum : companyNum;
    const toNum = isInbound ? companyNum : contactNum;
    const fromCoords = await phoneToCoords(fromNum);
    const toCoords = await phoneToCoords(toNum);

    const demoContactNames = ["Alex Chen", "Jordan Lee", "Riley Patel", "Morgan Diaz", "Sam Carter", "Taylor Brown", null, null];
    const demoAgentNames = ["Alice Smith", "Bob Johnson", "Charlie Williams", "Diana Brown"];
    const contactName = demoContactNames[Math.floor(Math.random() * demoContactNames.length)] || undefined;
    const agentName = demoAgentNames[Math.floor(Math.random() * demoAgentNames.length)];

    const callId = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const callData: CallData = {
      id: callId,
      direction,
      status: "active",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: new Date().toISOString(),
      timestamp: Date.now(),
      duration: null,
      durationText: null,
      contactName,
      contactNumber: contactNum,
      agentName,
      agentId: `demo-agent-${agentName.toLowerCase().replace(/\s+/g, "-")}`,
    };

    const tz = customer.timezone || "UTC";
    addCall(customerId, callData);
    statsNewCall(customerId, callId, direction, callData.timestamp);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
    persistStats(customerId, tz);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        statsAnswer(customerId, callId);
        broadcast(customerId, { type: "call.answered", callId, call: existing, stats: getStats(customerId) });
        persistStats(customerId, tz);
      }
    }, 2000 + Math.random() * 3000);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing) {
        const duration = Math.floor(30 + Math.random() * 300);
        existing.status = "ended";
        existing.duration = duration;
        existing.durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
        statsEndCall(customerId, callId, "answered", duration);
        broadcast(customerId, { type: "call.ended", call: existing, stats: getStats(customerId) });
        persistStats(customerId, tz);

        setTimeout(() => {
          const sentiments: CallData["sentiment"][] = ["Positive", "Neutral", "Neutral", "Neutral", "Negative"];
          const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
          if (existing && !existing.sentiment) {
            existing.sentiment = sentiment;
            statsSentiment(customerId, callId, sentiment!);
            broadcast(customerId, { type: "sentiment.update", callId, sentiment, stats: getStats(customerId) });
            persistStats(customerId, tz);
          }
        }, 1000 + Math.random() * 2000);
      }
    }, 8000 + Math.random() * 12000);

    res.json({ callId, status: "simulated" });
  });

  // --- Demo simulate team availability ---
  app.post("/api/customers/:customerId/demo/team-availability", requireAuthorized, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) return res.status(404).json({ error: "Customer not found" });

    const teamNames = ["Sales", "Support", "Billing", "Technical"];
    const teamName = req.body.teamName || teamNames[Math.floor(Math.random() * teamNames.length)];
    const teamId = req.body.teamId || `team-${teamName.toLowerCase()}`;
    const memberCount = req.body.memberCount || Math.floor(3 + Math.random() * 5);

    const firstNames = ["Alice", "Bob", "Charlie", "Diana", "Ethan", "Fiona", "George", "Hannah"];
    const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Davis", "Wilson", "Taylor", "Anderson"];
    const statuses: Array<"available" | "busy" | "offline"> = ["available", "available", "available", "busy", "busy", "offline"];
    const busyReasons = ["On a call", "In a meeting", "On break", "Wrapping up"];

    const members = [];
    for (let i = 0; i < memberCount; i++) {
      const fn = firstNames[i % firstNames.length];
      const ln = lastNames[i % lastNames.length];
      const avStatus = statuses[Math.floor(Math.random() * statuses.length)];
      const isLoggedIn = avStatus !== "offline";
      members.push({
        id: `agent-${teamId}-${i}`,
        type: "user",
        status: "active",
        displayName: `${fn} ${ln}`,
        firstName: fn,
        lastName: ln,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
        jobTitle: i === 0 ? "Team Lead" : "Agent",
        loginStatus: isLoggedIn ? "loggedIn" : "loggedOut",
        availability: {
          status: avStatus,
          statusAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
          statusTimestamp: Date.now() - Math.random() * 3600000,
          availabilitySummary: avStatus === "available" ? "Ready" : avStatus === "busy" ? "On a call" : "Offline",
          notAvailableReason: avStatus === "busy" ? busyReasons[Math.floor(Math.random() * busyReasons.length)] : undefined,
        },
      });
    }

    const totalAvailable = members.filter(m => m.loginStatus === "loggedIn" && m.availability.status === "available").length;

    const fakeEvent = {
      data: {
        team: {
          id: teamId,
          displayName: teamName,
          availability: {
            totalMembers: memberCount,
            totalAvailable,
            status: totalAvailable > 0 ? "available" : "unavailable",
            availabilitySummary: `${totalAvailable} of ${memberCount} available`,
          },
          teamMembers: members,
        },
      },
    };

    handleTeamAvailability(customerId, fakeEvent);
    res.json({ teamId, teamName, memberCount, totalAvailable, status: "simulated" });
  });

  // --- Demo simulate team call (call with team assignment) ---
  app.post("/api/customers/:customerId/demo/team-call", requireAuthorized, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) return res.status(404).json({ error: "Customer not found" });

    const teamId = req.body.teamId || "team-support";
    const teamName = req.body.teamName || "Support";

    const phoneNumbers = ["+14155551234", "+12125559876", "+14085554321", "+13055558765"];
    const companyNumbers = ["+18005551000", "+442012345678"];
    const agentNames = ["Alice Smith", "Bob Johnson", "Charlie Williams", "Diana Brown"];
    const contactNames = ["Alex Chen", "Jordan Lee", "Riley Patel", "Morgan Diaz", null];

    const contactNum = phoneNumbers[Math.floor(Math.random() * phoneNumbers.length)];
    const companyNum = companyNumbers[Math.floor(Math.random() * companyNumbers.length)];
    const fromCoords = await phoneToCoords(contactNum);
    const toCoords = await phoneToCoords(companyNum);
    const agentName = agentNames[Math.floor(Math.random() * agentNames.length)];
    const contactName = contactNames[Math.floor(Math.random() * contactNames.length)] || undefined;

    const callId = `demo-team-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const tz = customer.timezone || "UTC";

    const callData: CallData = {
      id: callId,
      direction: "inbound",
      status: "active",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: new Date().toISOString(),
      timestamp: Date.now(),
      duration: null,
      durationText: null,
      teamId,
      teamName,
      agentId: `agent-${teamId}-0`,
      agentName,
      contactName,
      contactNumber: contactNum,
    };

    addCall(customerId, callData);
    statsNewCall(customerId, callId, "inbound", callData.timestamp);
    teamStatsNewCall(customerId, teamId, callId, "inbound", callData.timestamp);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
    const teamStats = getTeamStats(customerId, teamId);
    broadcastToTeam(customerId, teamId, { type: "call.started", call: callData, stats: teamStats });
    broadcast(customerId, { type: "team.stats", teamId, stats: teamStats });
    persistStats(customerId, tz);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        existing.answeredAt = new Date().toISOString();
        statsAnswer(customerId, callId);
        teamStatsAnswer(customerId, teamId, callId);
        const ts = getTeamStats(customerId, teamId);
        broadcast(customerId, { type: "call.answered", callId, call: existing, stats: getStats(customerId) });
        broadcastToTeam(customerId, teamId, { type: "call.answered", callId, call: existing, stats: ts });
        persistStats(customerId, tz);
      }
    }, 2000 + Math.random() * 3000);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing) {
        const duration = Math.floor(30 + Math.random() * 300);
        existing.status = "ended";
        existing.duration = duration;
        existing.durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
        statsEndCall(customerId, callId, "answered", duration);
        // Simulate the payload's top-level waitTime attribute (ms) like real webhooks
        const simulatedWaitMs = Math.floor((5 + Math.random() * 40) * 1000);
        const simulatedWait = extractPayloadWaitSeconds({ waitTime: simulatedWaitMs });
        if (simulatedWait !== null) teamStatsRecordWait(customerId, teamId, callId, simulatedWait);
        teamStatsEndCall(customerId, teamId, callId, "answered", duration);
        const ts = getTeamStats(customerId, teamId);
        broadcast(customerId, { type: "call.ended", call: existing, stats: getStats(customerId) });
        broadcastToTeam(customerId, teamId, { type: "call.ended", call: existing, stats: ts });
        broadcast(customerId, { type: "team.stats", teamId, stats: ts });
        persistStats(customerId, tz);
      }
    }, 8000 + Math.random() * 12000);

    res.json({ callId, teamId, status: "simulated" });
  });

  // --- Demo: Team Call Data Action lifecycle (per-customer) ---
  // Simulates a queue-bound inbound call attributed via the Team Call data
  // action. Options (JSON body):
  //   teamId / teamName            — primary team (default team-sales / Sales)
  //   rolloverTeamId / rolloverTeamName — if set, the call rolls over to this
  //                                  team (missed for the primary team)
  //   outOfOrder: true             — data action is sent BEFORE call.started
  //   internal: true               — internal call; data action must be ignored
  app.post("/api/customers/:customerId/demo/team-call-data-action", requireAuthorized, async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const tz = customer.timezone || "UTC";

    const teamId = req.body?.teamId || "team-sales";
    const teamName = req.body?.teamName || "Sales";
    const rolloverTeamId = req.body?.rolloverTeamId || null;
    const rolloverTeamName = req.body?.rolloverTeamName || (rolloverTeamId ? String(rolloverTeamId) : null);
    const outOfOrder = req.body?.outOfOrder === true;
    const internal = req.body?.internal === true;

    const callId = `demo-da-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contactNumber = "+61298765432";
    const companyNumber = "+61388887777";
    const startedAt = new Date().toISOString();

    const startedEvent = {
      timestamp: Date.now(),
      data: {
        call: {
          id: callId,
          direction: "inbound",
          contactNumber,
          companyNumber,
          startedAt,
          contactName: "Demo Caller",
          isInternal: internal,
          // No directoryTarget → queue-bound
        },
      },
    };

    const sendDataAction = (tid: string, tname: string) => {
      const result = processTeamCallDataAction(customerId, tz, {
        callId,
        isInternal: internal,
        assignedCallGroup: { id: tid, displayName: tname, type: "team" },
      });
      log(`Demo data action [${customerId}]: ${result.status} call=${callId} team=${tid}`, "data-action");
      return result;
    };

    const timeline: string[] = [];

    if (outOfOrder) {
      // Data action first, call.started 1.5s later — exercises the pending map.
      sendDataAction(teamId, teamName);
      timeline.push("t=0s data action (held)", "t=1.5s call.started (assignment applied)");
      setTimeout(() => void handleCallStarted(customerId, startedEvent, tz).catch(() => {}), 1500);
    } else {
      await handleCallStarted(customerId, startedEvent, tz);
      timeline.push("t=0s call.started");
      setTimeout(() => sendDataAction(teamId, teamName), 800);
      timeline.push("t=0.8s data action → " + teamId);
    }

    if (internal) {
      // Internal calls are ignored by both the webhook and the data action.
      return res.json({ callId, status: "simulated_internal_ignored" });
    }

    if (rolloverTeamId) {
      setTimeout(() => sendDataAction(String(rolloverTeamId), String(rolloverTeamName)), 5000);
      timeline.push(`t=5s rollover data action → ${rolloverTeamId} (${teamId} records a missed call)`);
    }

    const finalTeamId = rolloverTeamId ? String(rolloverTeamId) : teamId;
    const finalTeamName = rolloverTeamId ? String(rolloverTeamName) : teamName;
    const answerDelayMs = rolloverTeamId ? 9000 : 4500;

    setTimeout(() => {
      if (!getCall(customerId, callId)) return;
      handleCallAnswered(customerId, {
        timestamp: Date.now(),
        data: {
          call: {
            id: callId,
            direction: "inbound",
            contactNumber,
            companyNumber,
            startedAt,
            answeredAt: new Date().toISOString(),
            waitTime: answerDelayMs,
            assignedCallGroup: { id: finalTeamId, displayName: finalTeamName, type: "team" },
            assignedUser: { id: "demo-agent-1", displayName: "Demo Agent" },
          },
        },
      }, tz);
    }, answerDelayMs);
    timeline.push(`t=${answerDelayMs / 1000}s call.answered by ${finalTeamId}`);

    const endDelayMs = answerDelayMs + 6000;
    setTimeout(() => {
      if (!getCall(customerId, callId)) return;
      handleCallEnded(customerId, {
        timestamp: Date.now(),
        data: {
          call: {
            id: callId,
            direction: "inbound",
            contactNumber,
            companyNumber,
            startedAt,
            duration: 6000,
            waitTime: answerDelayMs,
            outcome: { status: "answered" },
            assignedCallGroup: { id: finalTeamId, displayName: finalTeamName, type: "team" },
            assignedUser: { id: "demo-agent-1", displayName: "Demo Agent" },
          },
        },
      }, tz);
    }, endDelayMs);
    timeline.push(`t=${endDelayMs / 1000}s call.ended`);

    res.json({ callId, teamId, rolloverTeamId, outOfOrder, status: "simulated", timeline });
  });

  // --- Auth check endpoint (for frontend to check user's authorization level) ---
  app.get("/api/auth/me", isAuthenticated, async (req: any, res) => {
    const email = req.user?.claims?.email;
    if (!email) return res.status(401).json({ message: "No email in claims" });

    const hasUsers = await hasAnyAuthorizedUsers();
    if (!hasUsers) {
      return res.json({
        email,
        role: "admin",
        firstName: req.user.claims.given_name || null,
        lastName: req.user.claims.family_name || null,
        profileImageUrl: req.user.claims.picture || null,
        isBootstrap: true,
      });
    }

    const authUser = await getAuthorizedUser(email);
    if (!authUser) {
      return res.json({ email, role: null, authorized: false });
    }

    return res.json({
      email: authUser.email,
      role: authUser.role,
      firstName: req.user.claims.given_name || null,
      lastName: req.user.claims.family_name || null,
      profileImageUrl: req.user.claims.picture || null,
      authorized: true,
    });
  });

  // --- Authorized Users Management API (admin only) ---
  app.get("/api/admin/users", isAuthenticated, isAuthorizedAdmin, async (_req, res) => {
    const result = await pool.query(
      "SELECT id, email, role, created_at, first_name, last_name, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY created_at DESC"
    );
    const users = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      firstName: row.first_name,
      lastName: row.last_name,
      hasPassword: row.has_password,
    }));
    res.json(users);
  });

  app.post("/api/admin/users", isAuthenticated, isAuthorizedAdmin, async (req: any, res) => {
    const parsed = insertAuthorizedUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, role, firstName, lastName } = parsed.data;
    const sendInvite = req.body?.sendInvite === true;
    // Names are only collected for admin users (used in invite emails etc.).
    const first = role === "admin" && firstName ? firstName : null;
    const last = role === "admin" && lastName ? lastName : null;

    try {
      // Add the user with no password — they set one on their first sign-in.
      const result = await pool.query(
        "INSERT INTO users (email, role, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id, email, role, created_at, first_name, last_name",
        [email.toLowerCase(), role, first, last]
      );
      const row = result.rows[0];

      // Optionally send an invite email. The user is already created — a
      // failed email must never undo that, so failures become a warning.
      let inviteEmailSent = false;
      let inviteEmailError: string | undefined;
      if (sendInvite) {
        try {
          const claims = req.user?.claims || {};
          const inviterName = [claims.given_name, claims.family_name].filter(Boolean).join(" ").trim();
          const invitedBy = inviterName || claims.email || "An administrator";
          await sendInviteEmail({
            userId: row.id,
            email: row.email,
            role: row.role,
            invitedBy,
          });
          inviteEmailSent = true;
        } catch (emailErr: any) {
          console.error("[admin] Failed to send invite email:", emailErr);
          inviteEmailError = emailErr?.message || "Failed to send invite email";
        }
      }

      res.status(201).json({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        firstName: row.first_name,
        lastName: row.last_name,
        hasPassword: false,
        inviteEmailSent,
        ...(inviteEmailError ? { inviteEmailError } : {}),
      });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "User with this email already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/admin/users/:userId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { userId } = req.params;
    const { role, firstName, lastName } = req.body ?? {};

    if (role !== undefined && !["admin", "viewer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const validName = (v: any) => v === undefined || v === null || (typeof v === "string" && v.length <= 255);
    if (!validName(firstName) || !validName(lastName)) {
      return res.status(400).json({ error: "Invalid name" });
    }
    if (role === undefined && firstName === undefined && lastName === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const sets: string[] = ["updated_at = now()"];
    const params: any[] = [];
    if (role !== undefined) {
      params.push(role);
      sets.push(`role = $${params.length}`);
    }
    if (firstName !== undefined) {
      params.push(typeof firstName === "string" && firstName.trim() ? firstName.trim() : null);
      sets.push(`first_name = $${params.length}`);
    }
    if (lastName !== undefined) {
      params.push(typeof lastName === "string" && lastName.trim() ? lastName.trim() : null);
      sets.push(`last_name = $${params.length}`);
    }
    params.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, email, role, created_at, first_name, last_name, (password_hash IS NOT NULL) AS has_password`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const row = result.rows[0];

    // Keep active sessions in sync: session claims (given_name/family_name)
    // are a snapshot from sign-in, so a name edit would otherwise show the
    // old name (e.g. in invite emails) until the user logs in again.
    if (firstName !== undefined || lastName !== undefined) {
      try {
        await pool.query(
          `UPDATE sessions
           SET sess = jsonb_set(
             jsonb_set(
               sess,
               '{passport,user,claims,given_name}',
               COALESCE(to_jsonb($1::text), 'null'::jsonb)
             ),
             '{passport,user,claims,family_name}',
             COALESCE(to_jsonb($2::text), 'null'::jsonb)
           )
           WHERE sess->'passport'->'user'->'claims'->>'sub' = $3`,
          [row.first_name, row.last_name, userId]
        );
        // If the admin edited their own account, refresh the in-memory session
        // for this request too, so it isn't re-saved with the stale name.
        const reqUser: any = (req as any).user;
        if (reqUser?.claims?.sub === userId) {
          reqUser.claims.given_name = row.first_name;
          reqUser.claims.family_name = row.last_name;
        }
      } catch (sessErr) {
        console.error("[admin] Failed to refresh session claims after name update:", sessErr);
      }
    }

    res.json({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      firstName: row.first_name,
      lastName: row.last_name,
      hasPassword: row.has_password,
    });
  });

  // Reset a user's password: clears password_hash so they set a new one on
  // their next sign-in (first-sign-in flow). Admin only.
  app.post("/api/admin/users/:userId/reset-password", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { userId } = req.params;
    const result = await pool.query(
      "UPDATE users SET password_hash = NULL, updated_at = now() WHERE id = $1 RETURNING email",
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ reset: true, email: result.rows[0].email });
  });

  app.delete("/api/admin/users/:userId", isAuthenticated, isAuthorizedAdmin, async (req: any, res) => {
    const { userId } = req.params;
    const currentEmail = req.user?.claims?.email;
    const target = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    if (target.rows.length > 0 && target.rows[0].email?.toLowerCase() === currentEmail?.toLowerCase()) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    res.json({ deleted: true });
  });

  // --- Admin API (protected) ---
  app.get("/api/admin/customers", isAuthenticated, isAuthorizedAdmin, async (_req, res) => {
    const result = await pool.query("SELECT * FROM customers ORDER BY created_at DESC");
    const customers: Customer[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      ipAllowlist: row.ip_allowlist || [],
      timezone: row.timezone || "UTC",
      defaultRegion: row.default_region || "world",
      createdAt: row.created_at,
    }));
    res.json(customers);
  });

  app.post("/api/admin/customers", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const parsed = insertCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { id, name, active, ipAllowlist, timezone, defaultRegion } = parsed.data;

    try {
      await pool.query(
        "INSERT INTO customers (id, name, active, ip_allowlist, timezone, default_region) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, name, active, ipAllowlist, timezone, defaultRegion]
      );
      await loadFromDb(id, timezone);
      const customer = await getCustomer(id);
      res.status(201).json(customer);
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Customer ID already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/admin/customers/:customerId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId } = req.params;
    const existing = await getCustomer(customerId);
    if (!existing) return res.status(404).json({ error: "Customer not found" });

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (req.body.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(req.body.name);
    }
    if (req.body.active !== undefined) {
      updates.push(`active = $${idx++}`);
      values.push(req.body.active);
    }
    if (req.body.ipAllowlist !== undefined) {
      updates.push(`ip_allowlist = $${idx++}`);
      values.push(req.body.ipAllowlist);
    }
    if (req.body.timezone !== undefined) {
      updates.push(`timezone = $${idx++}`);
      values.push(req.body.timezone);
    }
    if (req.body.defaultRegion !== undefined) {
      updates.push(`default_region = $${idx++}`);
      values.push(req.body.defaultRegion);
    }

    if (updates.length === 0) return res.json(existing);

    values.push(customerId);
    await pool.query(
      `UPDATE customers SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );

    const updated = await getCustomer(customerId);
    res.json(updated);
  });

  app.delete("/api/admin/customers/:customerId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId } = req.params;
    await pool.query("DELETE FROM customers WHERE id = $1", [customerId]);
    await pool.query("DELETE FROM wallboard_stats WHERE customer_id = $1", [customerId]);
    res.json({ deleted: true });
  });

  app.get("/api/admin/settings", isAuthenticated, isAuthorizedAdmin, async (_req, res) => {
    try {
      const result = await pool.query("SELECT key, value FROM app_settings");
      const settings: Record<string, string> = {};
      for (const row of result.rows) {
        settings[row.key] = row.value;
      }
      if (!settings["app_company_name"]) {
        settings["app_company_name"] = "Your Company Name";
      }
      res.json(settings);
    } catch (err) {
      console.error("[api] Failed to get settings:", err);
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.get("/api/public/settings", async (_req, res) => {
    try {
      const result = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('app_company_name', 'app_company_logo')");
      const settings: Record<string, string> = {};
      for (const row of result.rows) settings[row.key] = row.value;
      res.json({
        companyName: settings["app_company_name"] || "Your Company Name",
        logoUrl: settings["app_company_logo"] || null,
      });
    } catch (err) {
      console.error("[api] Failed to get public settings:", err);
      res.json({ companyName: "Your Company Name", logoUrl: null });
    }
  });

  app.patch("/api/admin/settings", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    try {
      const { spoke_timezone, app_company_name, app_company_logo, spoke_ip_allowlist } = req.body;

      // Validate the logo before writing anything so a bad value cannot leave a partial save.
      const removingLogo = app_company_logo === null || app_company_logo === "";

      console.log(
        `[api] PATCH /admin/settings fields: ` +
          `name=${app_company_name !== undefined ? "present" : "absent"} ` +
          `logo=${app_company_logo !== undefined ? (removingLogo ? "remove" : "set") : "absent"} ` +
          `timezone=${spoke_timezone !== undefined ? "present" : "absent"}`
      );
      if (app_company_logo !== undefined && !removingLogo) {
        if (typeof app_company_logo !== "string" || !app_company_logo.startsWith("data:image/")) {
          return res.status(400).json({
            error: "Logo must be a valid image (a data:image/... URL). Please choose a PNG, JPG, or SVG file.",
          });
        }
      }

      if (spoke_timezone !== undefined) {
        await pool.query(
          "INSERT INTO app_settings (key, value) VALUES ('spoke_timezone', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [spoke_timezone]
        );
      }
      if (spoke_ip_allowlist !== undefined) {
        // Normalize to a clean comma-separated string regardless of whether the
        // client sent an array or a raw string.
        const normalized = (Array.isArray(spoke_ip_allowlist)
          ? spoke_ip_allowlist
          : String(spoke_ip_allowlist).split(","))
          .map((s: string) => s.trim())
          .filter(Boolean)
          .join(", ");
        await pool.query(
          "INSERT INTO app_settings (key, value) VALUES ('spoke_ip_allowlist', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [normalized]
        );
      }
      if (app_company_name !== undefined) {
        await pool.query(
          "INSERT INTO app_settings (key, value) VALUES ('app_company_name', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [app_company_name]
        );
      }
      if (app_company_logo !== undefined) {
        if (removingLogo) {
          await pool.query("DELETE FROM app_settings WHERE key = 'app_company_logo'");
        } else {
          await pool.query(
            "INSERT INTO app_settings (key, value) VALUES ('app_company_logo', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [app_company_logo]
          );
        }
      }
      const result = await pool.query("SELECT key, value FROM app_settings");
      const settings: Record<string, string> = {};
      for (const row of result.rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    } catch (err) {
      console.error("[api] Failed to update settings:", err);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // --- Team Management API (admin only) ---
  app.get("/api/admin/customers/:customerId/teams", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId } = req.params;
    const result = await pool.query(
      "SELECT * FROM customer_teams WHERE customer_id = $1 ORDER BY team_name",
      [customerId]
    );
    const teams: CustomerTeam[] = result.rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      teamId: row.team_id,
      teamName: row.team_name,
      enabled: row.enabled,
      slaAnswerSeconds: row.sla_answer_seconds ?? null,
      createdAt: row.created_at,
    }));
    res.json(teams);
  });

  app.patch("/api/admin/customers/:customerId/teams/:teamId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId, teamId } = req.params;
    const { enabled, slaAnswerSeconds } = req.body;

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (typeof enabled === "boolean") {
      setClauses.push(`enabled = $${paramIdx++}`);
      params.push(enabled);
    }
    if (slaAnswerSeconds !== undefined) {
      const val = slaAnswerSeconds === null || slaAnswerSeconds === "" ? null : parseInt(slaAnswerSeconds, 10);
      if (val !== null && (isNaN(val) || val < 0)) {
        return res.status(400).json({ error: "slaAnswerSeconds must be a positive number or null" });
      }
      setClauses.push(`sla_answer_seconds = $${paramIdx++}`);
      params.push(val);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    params.push(customerId, teamId);
    const result = await pool.query(
      `UPDATE customer_teams SET ${setClauses.join(", ")} WHERE customer_id = $${paramIdx++} AND team_id = $${paramIdx++} RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Team not found" });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      customerId: row.customer_id,
      teamId: row.team_id,
      teamName: row.team_name,
      enabled: row.enabled,
      slaAnswerSeconds: row.sla_answer_seconds ?? null,
      createdAt: row.created_at,
    });
  });

  // --- Public: enabled teams for a customer (used by dashboard) ---
  app.get("/api/customers/:customerId/teams", canViewCustomer, async (req, res) => {
    const { customerId } = req.params;
    const result = await pool.query(
      "SELECT team_id, team_name, sla_answer_seconds FROM customer_teams WHERE customer_id = $1 AND enabled = true ORDER BY team_name",
      [customerId]
    );
    res.json(result.rows.map((row) => ({ teamId: row.team_id, teamName: row.team_name, slaAnswerSeconds: row.sla_answer_seconds ?? null })));
  });

  // --- Admin: Team Group CRUD ---
  function toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  app.get("/api/admin/customers/:customerId/groups", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId } = req.params;
    const result = await pool.query(
      `SELECT g.*, COUNT(m.id)::int AS team_count
       FROM customer_team_groups g
       LEFT JOIN customer_team_group_members m ON m.group_id = g.id
       GROUP BY g.id
       HAVING g.customer_id = $1
       ORDER BY g.name`,
      [customerId]
    );
    res.json(result.rows.map((r: any) => ({
      id: r.id, customerId: r.customer_id, name: r.name, slug: r.slug,
      createdAt: r.created_at, teamCount: r.team_count,
    })));
  });

  app.post("/api/admin/customers/:customerId/groups", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    let slug = toSlug(name.trim());
    const existing = await pool.query(
      "SELECT id FROM customer_team_groups WHERE customer_id = $1 AND slug = $2",
      [customerId, slug]
    );
    if (existing.rows.length > 0) {
      slug = slug + "-" + Date.now().toString(36).slice(-4);
    }
    const result = await pool.query(
      "INSERT INTO customer_team_groups (customer_id, name, slug) VALUES ($1, $2, $3) RETURNING *",
      [customerId, name.trim(), slug]
    );
    const r = result.rows[0];
    res.json({ id: r.id, customerId: r.customer_id, name: r.name, slug: r.slug, createdAt: r.created_at, teamCount: 0 });
  });

  app.patch("/api/admin/customers/:customerId/groups/:groupId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId, groupId } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    const result = await pool.query(
      "UPDATE customer_team_groups SET name = $1 WHERE id = $2 AND customer_id = $3 RETURNING *",
      [name.trim(), groupId, customerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Group not found" });
    const r = result.rows[0];
    res.json({ id: r.id, customerId: r.customer_id, name: r.name, slug: r.slug, createdAt: r.created_at });
  });

  app.delete("/api/admin/customers/:customerId/groups/:groupId", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId, groupId } = req.params;
    const result = await pool.query(
      "DELETE FROM customer_team_groups WHERE id = $1 AND customer_id = $2 RETURNING id",
      [groupId, customerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Group not found" });
    res.json({ success: true });
  });

  app.get("/api/admin/customers/:customerId/groups/:groupId/teams", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId, groupId } = req.params;
    const result = await pool.query(
      `SELECT ct.team_id, ct.team_name, ct.enabled,
              CASE WHEN m.id IS NOT NULL THEN true ELSE false END AS in_group
       FROM customer_teams ct
       LEFT JOIN customer_team_group_members m ON m.team_id = ct.team_id AND m.group_id = $1
       WHERE ct.customer_id = $2 AND ct.enabled = true
       ORDER BY ct.team_name`,
      [groupId, customerId]
    );
    res.json(result.rows.map((r: any) => ({
      teamId: r.team_id, teamName: r.team_name, inGroup: r.in_group,
    })));
  });

  app.put("/api/admin/customers/:customerId/groups/:groupId/teams", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const { customerId, groupId } = req.params;
    const { teamIds } = req.body;
    if (!Array.isArray(teamIds)) {
      return res.status(400).json({ error: "teamIds must be an array" });
    }
    const groupCheck = await pool.query(
      "SELECT id FROM customer_team_groups WHERE id = $1 AND customer_id = $2",
      [groupId, customerId]
    );
    if (groupCheck.rows.length === 0) return res.status(404).json({ error: "Group not found" });

    await pool.query("DELETE FROM customer_team_group_members WHERE group_id = $1", [groupId]);
    for (const teamId of teamIds) {
      await pool.query(
        "INSERT INTO customer_team_group_members (group_id, customer_id, team_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [groupId, customerId, teamId]
      );
    }
    res.json({ success: true, count: teamIds.length });
  });

  // --- Public: Team Groups for a customer ---
  app.get("/api/customers/:customerId/groups", canViewCustomer, async (req, res) => {
    const { customerId } = req.params;
    const result = await pool.query(
      `SELECT g.id, g.name, g.slug, COUNT(m.id)::int AS team_count
       FROM customer_team_groups g
       LEFT JOIN customer_team_group_members m ON m.group_id = g.id
       WHERE g.customer_id = $1
       GROUP BY g.id
       ORDER BY g.name`,
      [customerId]
    );
    res.json(result.rows.map((r: any) => ({
      id: r.id, name: r.name, slug: r.slug, teamCount: r.team_count,
    })));
  });

  app.get("/api/customers/:customerId/groups/:slug", canViewCustomer, async (req, res) => {
    const { customerId, slug } = req.params;
    const groupResult = await pool.query(
      "SELECT * FROM customer_team_groups WHERE customer_id = $1 AND slug = $2",
      [customerId, slug]
    );
    if (groupResult.rows.length === 0) return res.status(404).json({ error: "Group not found" });
    const group = groupResult.rows[0];
    const teamsResult = await pool.query(
      `SELECT ct.team_id, ct.team_name, ct.sla_answer_seconds
       FROM customer_team_group_members m
       JOIN customer_teams ct ON ct.customer_id = m.customer_id AND ct.team_id = m.team_id AND ct.enabled = true
       WHERE m.group_id = $1
       ORDER BY ct.team_name`,
      [group.id]
    );
    const teamIds = teamsResult.rows.map((r: any) => r.team_id as string);
    const teamStatsMap: Record<string, any> = {};
    const allGroupCalls: CallData[] = [];
    for (const tid of teamIds) {
      teamStatsMap[tid] = getTeamStats(customerId, tid);
      const tc = getTeamRecentCalls(customerId, tid, 50);
      allGroupCalls.push(...tc);
    }
    allGroupCalls.sort((a, b) => b.timestamp - a.timestamp);
    res.json({
      id: group.id, customerId: group.customer_id, name: group.name, slug: group.slug,
      createdAt: group.created_at,
      teams: teamsResult.rows.map((r: any) => ({ teamId: r.team_id, teamName: r.team_name, slaAnswerSeconds: r.sla_answer_seconds ?? null })),
      teamStats: teamStatsMap,
      recentCalls: allGroupCalls.slice(0, 100),
    });
  });

  return httpServer;
}

// --- Webhook handlers (all tenant-scoped) ---

function extractTeamInfo(call: any): { teamId?: string; teamName?: string; agentId?: string; agentName?: string } {
  const result: { teamId?: string; teamName?: string; agentId?: string; agentName?: string } = {};
  if (call.assignedCallGroup) {
    result.teamId = call.assignedCallGroup.id;
    result.teamName = call.assignedCallGroup.displayName || call.assignedCallGroup.name;
  }
  if (call.assignedUser) {
    result.agentId = call.assignedUser.id;
    result.agentName = call.assignedUser.displayName || `${call.assignedUser.firstName || ""} ${call.assignedUser.lastName || ""}`.trim();
  } else if (call.directoryTarget) {
    result.agentId = call.directoryTarget.id;
    result.agentName = call.directoryTarget.displayName;
  }
  return result;
}

// Reads the caller wait time directly from the webhook payload's top-level
// `waitTime` attribute (milliseconds from initial ring to pickup), present on
// call.answered and call.ended events. Returns whole seconds, or null when
// the field is missing or invalid.
function extractPayloadWaitSeconds(call: any): number | null {
  const waitMs = call?.waitTime;
  if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs <= 0) return null;
  return Math.round(waitMs / 1000);
}

function extractContactName(call: any): string | undefined {
  if (call.contactName?.trim()) return call.contactName.trim();

  const ac = call.assignedContact;
  if (ac) {
    if (ac.companyName?.trim()) return ac.companyName.trim();
    const full = `${ac.firstName || ""} ${ac.lastName || ""}`.trim();
    if (full) return full;
  }

  if (Array.isArray(call.parties)) {
    for (const party of call.parties) {
      if (!party.isInternal && party.displayValue?.trim()) return party.displayValue.trim();
    }
  }

  return undefined;
}

async function handleCallStarted(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call || call.isInternal) return;

  if (isTenantCallEnded(customerId, call.id)) {
    log(`Ghost call.started ignored [${customerId}] callId=${call.id} (call already ended)`, "webhook");
    return;
  }

  if (getCall(customerId, call.id)) return;

  const isInbound = call.direction === "inbound";
  const fromCoords = await phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
  const toCoords = await phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
  const direction: "inbound" | "outbound" = call.direction;
  const teamInfo = extractTeamInfo(call);

  const callData: CallData = {
    id: call.id,
    direction,
    status: "active",
    sentiment: null,
    from: fromCoords,
    to: toCoords,
    fromLabel: fromCoords.name,
    toLabel: toCoords.name,
    startedAt: call.startedAt || new Date().toISOString(),
    timestamp: event.timestamp || Date.now(),
    duration: null,
    durationText: null,
    teamId: teamInfo.teamId,
    teamName: teamInfo.teamName,
    agentId: teamInfo.agentId,
    agentName: teamInfo.agentName,

    contactName: extractContactName(call),

    contactNumber: call.contactNumber || undefined,
  };

  addCall(customerId, callData);
  // Calls destined for an individual user carry a `directoryTarget` object;
  // queue-bound calls do not. So an inbound call.started without a
  // directoryTarget is a call ringing for some queue.
  const queueBound = isInbound && !call.directoryTarget;
  statsNewCall(customerId, call.id, direction, callData.timestamp, queueBound);
  broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });

  if (teamInfo.teamId) {
    if (isTeamCallEnded(customerId, teamInfo.teamId, call.id)) {
      log(`Ghost team call.started ignored [${customerId}] team=${teamInfo.teamId} callId=${call.id}`, "webhook");
    } else {
      if (teamInfo.teamName) ensureTeamInDb(customerId, teamInfo.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction, callData.timestamp);
      const teamStats = getTeamStats(customerId, teamInfo.teamId);
      log(`Team stats after call.started [${customerId}] team=${teamInfo.teamId} (${teamInfo.teamName}): active=${teamStats.active} total=${teamStats.total}`, "webhook");
      broadcastToTeam(customerId, teamInfo.teamId, {
        type: "call.started",
        call: callData,
        stats: teamStats,
      });
      broadcast(customerId, { type: "team.stats", teamId: teamInfo.teamId, stats: teamStats });
    }
  } else {
    log(`No teamId for call ${call.id} [${customerId}] — will be assigned when call.answered/call.not_answered arrives with assignedCallGroup`, "webhook");
  }

  // A Team Call data action may have arrived BEFORE this call.started webhook
  // (ordering is not guaranteed). Apply the held assignment now.
  const pending = takePendingTeamAssignment(customerId, call.id);
  if (pending) {
    log(`Applying held data-action assignment [${customerId}] call=${call.id} team=${pending.teamId}`, "data-action");
    applyTeamCallDataAction(customerId, call.id, pending.teamId, pending.teamName, tz);
  }

  persistStats(customerId, tz);
}

// Records a team the call is rolling over FROM on the in-memory call object,
// so wallboards can show "via Team A" on a ringing call that overflowed.
// Live-only ticker data (never persisted). Appends in rollover order, skips
// consecutive duplicates, and caps the list to guard against pathological
// rollover loops.
const MAX_VIA_TEAMS = 10;

// A data action arriving more than this long after a call was ended is a
// late/replayed message, not evidence of a live rollover.
const REVIVE_WINDOW_MS = 2 * 60 * 1000;
function addViaTeam(call: CallData, teamId: string, teamName: string) {
  if (!call.viaTeams) call.viaTeams = [];
  const last = call.viaTeams[call.viaTeams.length - 1];
  if (last && last.teamId === teamId) return;
  if (call.viaTeams.length >= MAX_VIA_TEAMS) return;
  call.viaTeams.push({ teamId, teamName });
}

// Applies a Team Call data action to a live call: attributes the ringing call
// to the given team, or — when the call was already attributed to a DIFFERENT
// team — performs a queue rollover (missed call for the previous team, fresh
// ringing call + wait timer for the new team). Customer-level stats are never
// touched: it is one physical call regardless of how many teams it visits.
// Returns false when the call is not known yet (caller should hold it).
function applyTeamCallDataAction(customerId: string, callId: string, teamId: string, teamName: string | undefined, tz: string): boolean {
  const call = getCall(customerId, callId);
  if (!call) return false;
  if (call.status === "answered" || call.status === "ended") {
    // Call already answered or fully over — team credit is handled by the
    // call.answered / call.ended webhooks.
    return true;
  }
  if (call.status === "missed" || isTenantCallEnded(customerId, callId)) {
    // A call.not_answered webhook (queue timeout on the previous team) ended
    // this call at the customer level moments before this data action
    // arrived. Only treat the data action as rollover evidence when it names
    // a DIFFERENT team than the one the call was attributed to AND it arrives
    // shortly after the premature end — otherwise it is a late/replayed data
    // action for a genuinely finished call and must not resurrect it.
    const endedAt = getTenantCallEndedAt(customerId, callId);
    const withinWindow = endedAt !== null && Date.now() - endedAt <= REVIVE_WINDOW_MS;
    const isRollover = !!call.teamId && call.teamId !== teamId && withinWindow;
    if (!isRollover) {
      log(`Ignored stale data action for ended call [${customerId}] call=${callId} team=${teamId}`, "data-action");
      return true;
    }
    // The data action proves the call is still live and rolling over —
    // revive it and continue as a normal rollover. The previous team's
    // missed call + wait credit were already recorded when the
    // call.not_answered webhook was processed.
    statsReviveCall(customerId, callId);
    call.status = "active";
    log(`Revived prematurely-ended call [${customerId}] call=${callId} — rollover to team ${teamId} in flight`, "data-action");
    broadcast(customerId, { type: "call.updated", callId, call });
  }

  const prevTeamId = call.teamId;
  if (prevTeamId === teamId) {
    // Same team the call is already counted for — just make sure a live wait
    // timer exists. Never double-counts.
    markTeamCallWaiting(customerId, teamId, callId);
    const teamStats = getTeamStats(customerId, teamId);
    broadcastToTeam(customerId, teamId, { type: "team.stats", teamId, stats: teamStats });
    broadcast(customerId, { type: "team.stats", teamId, stats: teamStats });
    return true;
  }

  if (prevTeamId) {
    // Rollover: the previous team did not answer in time — credit it with a
    // missed call and remove the call from its queue.
    addViaTeam(call, prevTeamId, call.teamName || prevTeamId);
    teamRolloverMiss(customerId, prevTeamId, callId);
    const prevStats = getTeamStats(customerId, prevTeamId);
    log(`Rollover [${customerId}] call=${callId}: ${prevTeamId} missed → ${teamId}`, "data-action");
    broadcastToTeam(customerId, prevTeamId, {
      type: "call.not_answered",
      callId,
      call: { ...call, status: "missed" as const },
      stats: prevStats,
    });
    broadcast(customerId, { type: "team.stats", teamId: prevTeamId, stats: prevStats });
  }

  call.teamId = teamId;
  call.teamName = teamName || teamId;
  ensureTeamInDb(customerId, teamId, call.teamName);
  teamAttributeRingingCall(customerId, teamId, callId, call.direction, call.timestamp);
  const teamStats = getTeamStats(customerId, teamId);
  broadcastToTeam(customerId, teamId, { type: "call.started", call, stats: teamStats });
  broadcast(customerId, { type: "team.stats", teamId, stats: teamStats });
  broadcast(customerId, { type: "call.updated", callId, call });
  persistStats(customerId, tz);
  return true;
}

// Parses and processes a Team Call data action payload. Shared by the public
// data-action endpoint and the demo simulator. Lenient about payload shape:
// accepts callId/assignedCallGroup at the top level or nested under call/data.
function processTeamCallDataAction(
  customerId: string,
  tz: string,
  body: any
): { status: string; callId?: string; teamId?: string } {
  const call = body?.call || body?.data?.call || body || {};
  const isInternal = body?.isInternal ?? call?.isInternal;
  if (isInternal === true) return { status: "ignored_internal" };

  const callId = body?.callId || call?.id;
  const acg = body?.assignedCallGroup || call?.assignedCallGroup;
  if (!callId || !acg?.id) return { status: "ignored_invalid_payload" };
  if (acg.type && acg.type !== "team") return { status: "ignored_not_team", callId: String(callId) };

  const teamId = String(acg.id);
  const teamName = acg.displayName || acg.name || undefined;
  const applied = applyTeamCallDataAction(customerId, String(callId), teamId, teamName, tz);
  if (!applied) {
    setPendingTeamAssignment(customerId, String(callId), teamId, teamName);
    return { status: "held_pending_call_started", callId: String(callId), teamId };
  }
  return { status: "applied", callId: String(callId), teamId };
}

async function handleCallAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  if (existing) {
    existing.status = "answered";
    existing.answeredAt = call.answeredAt;
    log(`call.answered agent fields [${customerId}] callId=${call.id} assignedUser=${JSON.stringify(call.assignedUser ?? null)} answeredBy=${JSON.stringify(call.answeredBy ?? null)}`, "webhook");
    const teamInfo = extractTeamInfo(call);
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (teamInfo.teamId && existing.teamId && teamInfo.teamId !== existing.teamId) {
      // The answering team differs from the team we attributed the ringing
      // call to (e.g. a rollover whose data action we never received). Treat
      // it the same way: the earlier team missed it, the answering team gets
      // a fresh call. Customer-level stats are untouched.
      addViaTeam(existing, existing.teamId, existing.teamName || existing.teamId);
      teamRolloverMiss(customerId, existing.teamId, call.id);
      const prevStats = getTeamStats(customerId, existing.teamId);
      log(`Answer-team mismatch [${customerId}] call=${call.id}: ${existing.teamId} missed → ${teamInfo.teamId}`, "data-action");
      broadcastToTeam(customerId, existing.teamId, {
        type: "call.not_answered",
        callId: call.id,
        call: { ...existing, status: "missed" as const },
        stats: prevStats,
      });
      broadcast(customerId, { type: "team.stats", teamId: existing.teamId, stats: prevStats });
      existing.teamId = teamInfo.teamId;
      existing.teamName = teamInfo.teamName;
      if (teamInfo.teamName) ensureTeamInDb(customerId, teamInfo.teamId, teamInfo.teamName);
      teamAttributeRingingCall(customerId, teamInfo.teamId, call.id, existing.direction || "inbound", existing.timestamp);
      broadcastToTeam(customerId, teamInfo.teamId, {
        type: "call.started",
        call: { ...existing, status: "active" as const },
        stats: getTeamStats(customerId, teamInfo.teamId),
      });
    }
    if (teamInfo.agentId) { existing.agentId = teamInfo.agentId; existing.agentName = teamInfo.agentName; }
    if (!existing.contactName) existing.contactName = extractContactName(call);
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.answered", callId: call.id, call: existing, stats: getStats(customerId) });

    if (existing.teamId) {
      if (teamFirstDiscovered) {
        if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
        teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound", existing.timestamp);
        log(`Team discovered on call.answered [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
        const callForTeam = { ...existing, status: "active" as const };
        broadcastToTeam(customerId, existing.teamId, {
          type: "call.started",
          call: callForTeam,
          stats: getTeamStats(customerId, existing.teamId),
        });
      }
      // For rolled-over calls the payload's waitTime spans the ENTIRE call
      // (initial ring across all teams). The answering team should only be
      // credited with the time the call rang in ITS queue, so use the
      // team-local ring timer instead. Capture it before teamStatsAnswer
      // clears the timer.
      const rolledOver = !!(existing.viaTeams && existing.viaTeams.length > 0);
      const localRingStart = rolledOver ? getTeamRingStart(customerId, existing.teamId, call.id) : null;
      teamStatsAnswer(customerId, existing.teamId, call.id, existing.direction || undefined);
      if (rolledOver) {
        if (localRingStart) teamStatsRecordWait(customerId, existing.teamId, call.id, (Date.now() - localRingStart) / 1000);
      } else {
        const waitSeconds = extractPayloadWaitSeconds(call);
        if (waitSeconds !== null) teamStatsRecordWait(customerId, existing.teamId, call.id, waitSeconds);
      }
      const teamStats = getTeamStats(customerId, existing.teamId);
      log(`Team stats after call.answered [${customerId}] team=${existing.teamId}: active=${teamStats.active} total=${teamStats.total}`, "webhook");
      broadcastToTeam(customerId, existing.teamId, { type: "call.answered", callId: call.id, call: existing, stats: teamStats });
      broadcast(customerId, { type: "team.stats", teamId: existing.teamId, stats: teamStats });
    }

    persistStats(customerId, tz);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = await phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = await phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const direction: "inbound" | "outbound" = call.direction || "inbound";
    const teamInfo = extractTeamInfo(call);

    const callData: CallData = {
      id: call.id,
      direction,
      status: "answered",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration: null,
      durationText: null,
      answeredAt: call.answeredAt,
      teamId: teamInfo.teamId,
      teamName: teamInfo.teamName,
      agentId: teamInfo.agentId,
      agentName: teamInfo.agentName,

      contactName: extractContactName(call),

      contactNumber: call.contactNumber || undefined,
    };

    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction, callData.timestamp);
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });

    if (teamInfo.teamId) {
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction, callData.timestamp);
      teamStatsAnswer(customerId, teamInfo.teamId, call.id);
      const waitSeconds = extractPayloadWaitSeconds(call);
      if (waitSeconds !== null) teamStatsRecordWait(customerId, teamInfo.teamId, call.id, waitSeconds);
      const teamStats = getTeamStats(customerId, teamInfo.teamId);
      broadcastToTeam(customerId, teamInfo.teamId, { type: "call.started", call: callData, stats: teamStats });
      broadcast(customerId, { type: "team.stats", teamId: teamInfo.teamId, stats: teamStats });
    }

    persistStats(customerId, tz);
  }
}

async function handleCallEnded(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  const teamInfo = extractTeamInfo(call);

  if (existing) {
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (teamInfo.agentId && !existing.agentId) { existing.agentId = teamInfo.agentId; existing.agentName = teamInfo.agentName; }
    if (!existing.contactName) existing.contactName = extractContactName(call);

    if (existing.teamId && teamFirstDiscovered) {
      if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound", existing.timestamp);
      log(`Team discovered on call.ended [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
    }

    const outcomeStatus = call.outcome?.status;
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";

    if (isAnswered) {
      existing.status = "answered";
      statsAnswer(customerId, call.id);
      if (existing.teamId) {
        // Same rollover rule as call.answered: never let the payload's
        // whole-call waitTime overwrite a rolled-over team's local wait.
        const rolledOver = !!(existing.viaTeams && existing.viaTeams.length > 0);
        const localRingStart = rolledOver ? getTeamRingStart(customerId, existing.teamId, call.id) : null;
        teamStatsAnswer(customerId, existing.teamId, call.id);
        if (rolledOver) {
          if (localRingStart) teamStatsRecordWait(customerId, existing.teamId, call.id, (Date.now() - localRingStart) / 1000);
        } else {
          const waitSeconds = extractPayloadWaitSeconds(call);
          if (waitSeconds !== null) teamStatsRecordWait(customerId, existing.teamId, call.id, waitSeconds);
        }
      }
    } else if (existing.status === "active") {
      existing.status = "missed";
    }

    const duration = call.duration ? Math.round(call.duration / 1000) : null;
    existing.duration = duration || existing.duration;
    existing.durationText = call.durationText || existing.durationText;
    statsEndCall(customerId, call.id, existing.status, duration);
    if (existing.teamId) teamStatsEndCall(customerId, existing.teamId, call.id, existing.status, duration);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = await phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = await phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const outcomeStatus = call.outcome?.status;
    const direction: "inbound" | "outbound" = call.direction || "inbound";
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";
    const duration = call.duration ? Math.round(call.duration / 1000) : null;
    const finalStatus = isAnswered ? "answered" : "missed";

    const callData: CallData = {
      id: call.id,
      direction,
      status: finalStatus,
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration,
      durationText: call.durationText || null,
      teamId: teamInfo.teamId,
      teamName: teamInfo.teamName,
      agentId: teamInfo.agentId,
      agentName: teamInfo.agentName,

      contactName: extractContactName(call),

      contactNumber: call.contactNumber || undefined,
    };
    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction, callData.timestamp);
    if (isAnswered) statsAnswer(customerId, call.id);
    statsEndCall(customerId, call.id, finalStatus, duration);

    if (teamInfo.teamId) {
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction, callData.timestamp);
      if (isAnswered) {
        teamStatsAnswer(customerId, teamInfo.teamId, call.id);
        const waitSeconds = extractPayloadWaitSeconds(call);
        if (waitSeconds !== null) teamStatsRecordWait(customerId, teamInfo.teamId, call.id, waitSeconds);
      }
      teamStatsEndCall(customerId, teamInfo.teamId, call.id, finalStatus, duration);
    }
  }

  const finalCall = getCall(customerId, call.id);
  if (finalCall) {
    persistStats(customerId, tz);
    broadcast(customerId, { type: "call.ended", call: finalCall, stats: getStats(customerId) });
    if (finalCall.teamId) {
      const teamStats = getTeamStats(customerId, finalCall.teamId);
      broadcastToTeam(customerId, finalCall.teamId, { type: "call.ended", call: finalCall, stats: teamStats });
      broadcast(customerId, { type: "team.stats", teamId: finalCall.teamId, stats: teamStats });
    }
  }
}

async function handleCallNotAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  let existing = getCall(customerId, call.id);
  const teamInfo = extractTeamInfo(call);

  if (existing) {
    // Out-of-order rollover guard: if this queue-timeout notice names a team
    // the call has ALREADY rolled over from (a newer data action moved it to
    // a different team), credit the miss to that earlier team only and keep
    // the call ringing for its current team.
    if (
      teamInfo.teamId &&
      existing.teamId &&
      teamInfo.teamId !== existing.teamId &&
      existing.status === "active" &&
      teamOwnsCall(customerId, teamInfo.teamId, call.id)
    ) {
      teamStatsEndCall(customerId, teamInfo.teamId, call.id, "missed", null);
      const prevStats = getTeamStats(customerId, teamInfo.teamId);
      log(`call.not_answered for earlier team leg [${customerId}] call=${call.id} team=${teamInfo.teamId} — call still ringing for ${existing.teamId}`, "webhook");
      broadcastToTeam(customerId, teamInfo.teamId, {
        type: "call.not_answered",
        callId: call.id,
        call: { ...existing, teamId: teamInfo.teamId, teamName: teamInfo.teamName, status: "missed" as const },
        stats: prevStats,
      });
      broadcast(customerId, { type: "team.stats", teamId: teamInfo.teamId, stats: prevStats });
      persistStats(customerId, tz);
      return;
    }
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (!existing.contactName) existing.contactName = extractContactName(call);
    if (existing.teamId && teamFirstDiscovered) {
      if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound", existing.timestamp);
      log(`Team discovered on call.not_answered [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
    }
    existing.status = "missed";
    statsEndCall(customerId, call.id, "missed", null);
    if (existing.teamId) teamStatsEndCall(customerId, existing.teamId, call.id, "missed", null);
    persistStats(customerId, tz);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = await phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = await phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const direction: "inbound" | "outbound" = call.direction || "inbound";

    const callData: CallData = {
      id: call.id,
      direction,
      status: "missed",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration: null,
      durationText: null,
      teamId: teamInfo.teamId,
      teamName: teamInfo.teamName,
      agentId: teamInfo.agentId,
      agentName: teamInfo.agentName,

      contactName: extractContactName(call),

      contactNumber: call.contactNumber || undefined,
    };

    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction, callData.timestamp);
    statsEndCall(customerId, call.id, "missed", null);

    if (teamInfo.teamId) {
      if (teamInfo.teamName) ensureTeamInDb(customerId, teamInfo.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction, callData.timestamp);
      teamStatsEndCall(customerId, teamInfo.teamId, call.id, "missed", null);
    }

    existing = callData;
    persistStats(customerId, tz);
  }
  broadcast(customerId, { type: "call.not_answered", callId: call.id, stats: getStats(customerId) });
  const finalCall = getCall(customerId, call.id);
  if (finalCall?.teamId) {
    const teamStats = getTeamStats(customerId, finalCall.teamId);
    broadcastToTeam(customerId, finalCall.teamId, { type: "call.not_answered", callId: call.id, call: finalCall, stats: teamStats });
    broadcast(customerId, { type: "team.stats", teamId: finalCall.teamId, stats: teamStats });
  }
}

function handleContentAnalysis(customerId: string, event: any, tz?: string) {
  const ca = event.data?.contentAnalysis;
  if (!ca) return;
  const callId = ca.request?.source?.id;
  if (!callId) return;

  let sentiment: string | null = null;
  if (ca.artifacts && ca.artifacts.length > 0) {
    for (const artifact of ca.artifacts) {
      const data = artifact.data || {};
      if (data.sentiment) {
        sentiment = data.sentiment;
        break;
      }
      if (artifact.schema === "sentiment" && data.value) {
        sentiment = data.value;
        break;
      }
      if (data.customerSentiment) {
        sentiment = data.customerSentiment;
        break;
      }
    }
  }

  const normalized = normalizeSentiment(sentiment);
  if (!normalized) return;

  // Count even when the call has aged out of the live ticker —
  // statsSentiment guards against per-call double counting.
  const counted = statsSentiment(customerId, callId, normalized);
  const existing = getCall(customerId, callId);
  if (existing && !existing.sentiment) {
    existing.sentiment = normalized;
  }
  if (counted) {
    persistStats(customerId, tz);
    broadcast(customerId, { type: "sentiment.update", callId, sentiment: normalized, stats: getStats(customerId) });
  }
}

function handleTeamAvailability(customerId: string, event: any) {
  const team = event.data?.team;
  if (!team || !team.id) return;

  const teamId = team.id;
  const summary: TeamSummary = {
    id: teamId,
    displayName: team.displayName || teamId,
    totalMembers: team.availability?.totalMembers || 0,
    totalAvailable: team.availability?.totalAvailable || 0,
    status: team.availability?.status || "unknown",
    availabilitySummary: team.availability?.availabilitySummary || "",
  };

  const agents: TeamAgent[] = (team.teamMembers || [])
    .filter((m: any) => m.type === "user" && m.status === "active")
    .map((m: any) => ({
      id: m.id,
      displayName: m.displayName || `${m.firstName || ""} ${m.lastName || ""}`.trim(),
      firstName: m.firstName || "",
      lastName: m.lastName || "",
      email: m.email || "",
      jobTitle: m.jobTitle || undefined,
      location: m.location || undefined,
      loginStatus: m.loginStatus === "loggedIn" ? "loggedIn" : "loggedOut",
      availability: {
        status: mapAvailabilityStatus(m.availability?.status),
        statusAt: m.availability?.statusAt || new Date().toISOString(),
        statusTimestamp: m.availability?.statusTimestamp || Date.now(),
        availabilitySummary: m.availability?.availabilitySummary || "",
        notAvailableReason: m.availability?.notAvailableReason || undefined,
        callId: m.availability?.callId || undefined,
      },
    }));

  updateTeamAvailability(customerId, teamId, summary, agents);
  ensureTeamInDb(customerId, teamId, summary.displayName);

  const teamStats = getTeamStats(customerId, teamId);
  // Present the roster reconciled against live calls (an "available" agent
  // named on a live connected call is shown busy).
  const presentedAgents = reconcileTeamAgents(customerId, teamId, agents);

  broadcastToTeam(customerId, teamId, {
    type: "team.availability",
    teamId,
    summary,
    agents: presentedAgents,
    stats: teamStats,
  });

  broadcast(customerId, {
    type: "team.availability",
    teamId,
    summary,
    agents: presentedAgents,
    stats: teamStats,
  });

  log(`Team availability updated [${customerId}]: ${summary.displayName} (${summary.totalAvailable}/${summary.totalMembers} available)`, "webhook");
}

function handleUserAvailability(customerId: string, event: any) {
  const user = event.data?.user;
  if (!user || !user.id) return;

  const updatedAgent = {
    displayName: user.displayName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    jobTitle: user.jobTitle || undefined,
    location: user.location || undefined,
    loginStatus: (user.loginStatus === "loggedIn" ? "loggedIn" : "loggedOut") as "loggedIn" | "loggedOut",
    availability: {
      status: mapAvailabilityStatus(user.availability?.status),
      statusAt: user.availability?.statusAt || new Date().toISOString(),
      statusTimestamp: user.availability?.statusTimestamp || Date.now(),
      availabilitySummary: user.availability?.availabilitySummary || "",
      notAvailableReason: user.availability?.notAvailableReason || undefined,
      callId: user.availability?.callId || undefined,
    },
  };

  const affectedTeamIds = updateUserAvailabilityAcrossTeams(customerId, user.id, updatedAgent);

  const availCallId = updatedAgent.availability.callId;

  if (availCallId) {
    const liveCall = getCall(customerId, availCallId);
    if (liveCall && !liveCall.agentId && (liveCall.status === "active" || liveCall.status === "answered")) {
      liveCall.agentId = user.id;
      liveCall.agentName = updatedAgent.displayName;
      broadcast(customerId, { type: "call.updated", callId: availCallId, call: liveCall });
      log(`Agent patched onto call ticker from user.availability.updated [${customerId}] callId=${availCallId} agent=${updatedAgent.displayName}`, "webhook");
    }
  }

  for (const teamId of affectedTeamIds) {
    const teamState = getTeamState(customerId, teamId);
    if (teamState) {
      broadcastToTeam(customerId, teamId, {
        type: "team.availability",
        teamId,
        summary: teamState.summary,
        agents: teamState.agents,
        stats: teamState.stats,
      });
      broadcast(customerId, {
        type: "team.availability",
        teamId,
        summary: teamState.summary,
        agents: teamState.agents,
        stats: teamState.stats,
      });
      broadcast(customerId, { type: "team.stats", teamId, stats: teamState.stats });
    }
  }

  if (affectedTeamIds.length > 0) {
    log(`User availability updated [${customerId}]: ${updatedAgent.displayName} → ${updatedAgent.availability.status} (${affectedTeamIds.length} teams affected, callId=${availCallId || "none"})`, "webhook");
  }
}

function mapAvailabilityStatus(status: string | undefined): "available" | "busy" | "offline" | "ringing" {
  switch (status) {
    case "available": return "available";
    case "busy": return "busy";
    case "ringing": return "ringing";
    default: return "offline";
  }
}
