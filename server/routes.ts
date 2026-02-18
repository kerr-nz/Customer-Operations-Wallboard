import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cron from "node-cron";
import pg from "pg";
import { phoneToCoords } from "./geoLookup";
import {
  getTodayCalls,
  resetTenant,
  getStats,
  getGlobalStats,
  getGlobalRecentCalls,
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
  teamStatsNewCall,
  teamStatsAnswer,
  teamStatsEndCall,
  updateTeamAvailability,
  updateUserAvailabilityAcrossTeams,
  getTeamState,
  getAllTeamSummaries,
  getAllTeamStats,
  getTeamRecentCalls,
  getTeamStats,
  getTeamLiveWaitAvg,
} from "./webhookState";
import type { CallData, Customer, AuthorizedUser, CustomerTeam, TeamAgent, TeamSummary } from "@shared/schema";
import { insertCustomerSchema, insertAuthorizedUserSchema } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth";
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

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function checkIpAllowed(clientIp: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
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
  const result = await pool.query("SELECT * FROM authorized_users WHERE LOWER(email) = LOWER($1)", [email]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

async function hasAnyAuthorizedUsers(): Promise<boolean> {
  const result = await pool.query("SELECT COUNT(*) FROM authorized_users");
  return parseInt(result.rows[0].count) > 0;
}

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

const isAuthorizedViewer: RequestHandler = async (req: any, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.claims?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const email = req.user.claims.email;
  const hasUsers = await hasAnyAuthorizedUsers();
  if (!hasUsers) {
    return next();
  }
  const authUser = await getAuthorizedUser(email);
  if (!authUser) {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  }
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await loadAllActiveCustomers();

  await pool.query("UPDATE customer_teams SET sla_answer_seconds = 15 WHERE sla_answer_seconds IS NULL");

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname === "/ws/_spoke") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, "_spoke");
      });
    } else {
      const teamMatch = url.pathname.match(/^\/ws\/([^/]+)\/team\/([^/]+)$/);
      if (teamMatch) {
        const customerId = teamMatch[1];
        const teamId = teamMatch[2];
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, `team::${customerId}::${teamId}`);
        });
      } else {
        const match = url.pathname.match(/^\/ws\/(.+)$/);
        if (match) {
          const customerId = match[1];
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req, customerId);
          });
        }
      }
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

  // --- Webhook endpoint (per-customer) ---
  app.post("/webhook/:customerId", async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const clientIp = getClientIp(req);
    if (!checkIpAllowed(clientIp, customer.ipAllowlist)) {
      log(`IP ${clientIp} blocked for customer ${customerId}`, "webhook");
      return res.status(403).json({ error: "IP not allowed" });
    }

    const event = req.body;
    const eventType = event?.type;
    log(`Webhook [${customerId}]: ${eventType} (${event?.id})`, "webhook");

    const tz = customer.timezone || "UTC";
    try {
      switch (eventType) {
        case "call.started":
          handleCallStarted(customerId, event, tz);
          break;
        case "call.answered":
          handleCallAnswered(customerId, event, tz);
          break;
        case "call.ended":
        case "call.hungup":
          handleCallEnded(customerId, event, tz);
          break;
        case "call.not_answered":
          handleCallNotAnswered(customerId, event, tz);
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

  // --- Health endpoint ---
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      tenants: tenantWsClients.size,
    });
  });

  // --- Customer health endpoint ---
  app.get("/api/customers/:customerId/health", async (req, res) => {
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
  app.get("/api/customers/:customerId", async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({
      id: customer.id,
      name: customer.name,
      active: customer.active,
    });
  });

  // --- Reset endpoint (per-customer) ---
  app.post("/api/customers/:customerId/reset", async (req, res) => {
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
  app.post("/api/customers/:customerId/demo/simulate", async (req, res) => {
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
    const fromCoords = phoneToCoords(fromNum);
    const toCoords = phoneToCoords(toNum);

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
    };

    const tz = customer.timezone || "UTC";
    addCall(customerId, callData);
    statsNewCall(customerId, callId, direction);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
    persistStats(customerId, tz);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        statsAnswer(customerId, callId);
        broadcast(customerId, { type: "call.answered", callId, stats: getStats(customerId) });
        persistStats(customerId, tz);
      }
    }, 2000 + Math.random() * 3000);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing) {
        const duration = Math.floor(30 + Math.random() * 300);
        existing.status = "answered";
        existing.duration = duration;
        existing.durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
        statsEndCall(customerId, callId, "answered", duration);
        broadcast(customerId, { type: "call.ended", call: existing, stats: getStats(customerId) });
        persistStats(customerId, tz);

        setTimeout(() => {
          const sentiments: CallData["sentiment"][] = ["Happy", "Normal", "Normal", "Normal", "Angry"];
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
  app.post("/api/customers/:customerId/demo/team-availability", async (req, res) => {
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
  app.post("/api/customers/:customerId/demo/team-call", async (req, res) => {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    if (!customer || !customer.active) return res.status(404).json({ error: "Customer not found" });

    const teamId = req.body.teamId || "team-support";
    const teamName = req.body.teamName || "Support";

    const phoneNumbers = ["+14155551234", "+12125559876", "+14085554321", "+13055558765"];
    const companyNumbers = ["+18005551000", "+442012345678"];
    const agentNames = ["Alice Smith", "Bob Johnson", "Charlie Williams", "Diana Brown"];

    const contactNum = phoneNumbers[Math.floor(Math.random() * phoneNumbers.length)];
    const companyNum = companyNumbers[Math.floor(Math.random() * companyNumbers.length)];
    const fromCoords = phoneToCoords(contactNum);
    const toCoords = phoneToCoords(companyNum);
    const agentName = agentNames[Math.floor(Math.random() * agentNames.length)];

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
    };

    addCall(customerId, callData);
    statsNewCall(customerId, callId, "inbound");
    teamStatsNewCall(customerId, teamId, callId, "inbound");
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
    const teamStats = getTeamStats(customerId, teamId);
    broadcastToTeam(customerId, teamId, { type: "call.started", call: callData, stats: teamStats });
    broadcast(customerId, { type: "team.stats", teamId, stats: teamStats });
    persistStats(customerId, tz);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        statsAnswer(customerId, callId);
        teamStatsAnswer(customerId, teamId, callId);
        const ts = getTeamStats(customerId, teamId);
        broadcast(customerId, { type: "call.answered", callId, stats: getStats(customerId) });
        broadcastToTeam(customerId, teamId, { type: "call.answered", callId, stats: ts });
        persistStats(customerId, tz);
      }
    }, 2000 + Math.random() * 3000);

    setTimeout(() => {
      const existing = getCall(customerId, callId);
      if (existing) {
        const duration = Math.floor(30 + Math.random() * 300);
        existing.status = "answered";
        existing.duration = duration;
        existing.durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
        statsEndCall(customerId, callId, "answered", duration);
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

  // --- Auth check endpoint (for frontend to check user's authorization level) ---
  app.get("/api/auth/me", isAuthenticated, async (req: any, res) => {
    const email = req.user?.claims?.email;
    if (!email) return res.status(401).json({ message: "No email in claims" });

    const hasUsers = await hasAnyAuthorizedUsers();
    if (!hasUsers) {
      return res.json({
        email,
        role: "admin",
        firstName: req.user.claims.first_name || null,
        lastName: req.user.claims.last_name || null,
        profileImageUrl: req.user.claims.profile_image_url || null,
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
      firstName: req.user.claims.first_name || null,
      lastName: req.user.claims.last_name || null,
      profileImageUrl: req.user.claims.profile_image_url || null,
      authorized: true,
    });
  });

  // --- Authorized Users Management API (admin only) ---
  app.get("/api/admin/users", isAuthenticated, isAuthorizedAdmin, async (_req, res) => {
    const result = await pool.query("SELECT * FROM authorized_users ORDER BY created_at DESC");
    const users: AuthorizedUser[] = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      addedBy: row.added_by,
      createdAt: row.created_at,
    }));
    res.json(users);
  });

  app.post("/api/admin/users", isAuthenticated, isAuthorizedAdmin, async (req: any, res) => {
    const parsed = insertAuthorizedUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, role } = parsed.data;
    const addedBy = req.user?.claims?.email || "system";

    try {
      const result = await pool.query(
        "INSERT INTO authorized_users (email, role, added_by) VALUES ($1, $2, $3) RETURNING *",
        [email.toLowerCase(), role, addedBy]
      );
      const row = result.rows[0];
      res.status(201).json({
        id: row.id,
        email: row.email,
        role: row.role,
        addedBy: row.added_by,
        createdAt: row.created_at,
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
    const { role } = req.body;
    if (!role || !["admin", "viewer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const result = await pool.query(
      "UPDATE authorized_users SET role = $1 WHERE id = $2 RETURNING *",
      [role, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      email: row.email,
      role: row.role,
      addedBy: row.added_by,
      createdAt: row.created_at,
    });
  });

  app.delete("/api/admin/users/:userId", isAuthenticated, isAuthorizedAdmin, async (req: any, res) => {
    const { userId } = req.params;
    const currentEmail = req.user?.claims?.email;
    const target = await pool.query("SELECT email FROM authorized_users WHERE id = $1", [userId]);
    if (target.rows.length > 0 && target.rows[0].email.toLowerCase() === currentEmail?.toLowerCase()) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }
    await pool.query("DELETE FROM authorized_users WHERE id = $1", [userId]);
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
      res.json(settings);
    } catch (err) {
      console.error("[api] Failed to get settings:", err);
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.patch("/api/admin/settings", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    try {
      const { spoke_timezone } = req.body;
      if (spoke_timezone !== undefined) {
        await pool.query(
          "INSERT INTO app_settings (key, value) VALUES ('spoke_timezone', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [spoke_timezone]
        );
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
  app.get("/api/customers/:customerId/teams", async (req, res) => {
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
  app.get("/api/customers/:customerId/groups", async (req, res) => {
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

  app.get("/api/customers/:customerId/groups/:slug", async (req, res) => {
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

function handleCallStarted(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call || call.isInternal) return;

  if (getCall(customerId, call.id)) return;

  const isInbound = call.direction === "inbound";
  const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
  const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
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
  };

  addCall(customerId, callData);
  statsNewCall(customerId, call.id, direction);
  broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });

  if (teamInfo.teamId) {
    if (teamInfo.teamName) ensureTeamInDb(customerId, teamInfo.teamId, teamInfo.teamName);
    teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction);
    const teamStats = getTeamStats(customerId, teamInfo.teamId);
    log(`Team stats after call.started [${customerId}] team=${teamInfo.teamId} (${teamInfo.teamName}): active=${teamStats.active} waiting=${teamStats.callsWaiting} total=${teamStats.total}`, "webhook");
    const wsClients = tenantWsClients.get(customerId);
    log(`Broadcasting team.stats to ${wsClients?.size ?? 0} customer WS clients`, "webhook");
    broadcastToTeam(customerId, teamInfo.teamId, {
      type: "call.started",
      call: callData,
      stats: teamStats,
    });
    broadcast(customerId, { type: "team.stats", teamId: teamInfo.teamId, stats: teamStats });
  } else {
    log(`No teamId for call ${call.id} [${customerId}]. assignedCallGroup=${JSON.stringify(call.assignedCallGroup)}, keys=${Object.keys(call).join(",")}`, "webhook");
  }

  persistStats(customerId, tz);
}

function handleCallAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  if (existing) {
    existing.status = "answered";
    existing.answeredAt = call.answeredAt;
    const teamInfo = extractTeamInfo(call);
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (teamInfo.agentId && !existing.agentId) { existing.agentId = teamInfo.agentId; existing.agentName = teamInfo.agentName; }
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.answered", callId: call.id, stats: getStats(customerId) });

    if (existing.teamId) {
      if (teamFirstDiscovered) {
        if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
        teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound");
        log(`Team discovered on call.answered [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
        const callForTeam = { ...existing, status: "active" as const };
        broadcastToTeam(customerId, existing.teamId, {
          type: "call.started",
          call: callForTeam,
          stats: getTeamStats(customerId, existing.teamId),
        });
      }
      teamStatsAnswer(customerId, existing.teamId, call.id, existing.direction || undefined);
      const teamStats = getTeamStats(customerId, existing.teamId);
      log(`Team stats after call.answered [${customerId}] team=${existing.teamId}: active=${teamStats.active} waiting=${teamStats.callsWaiting} total=${teamStats.total}`, "webhook");
      broadcastToTeam(customerId, existing.teamId, { type: "call.answered", callId: call.id, stats: teamStats });
      broadcast(customerId, { type: "team.stats", teamId: existing.teamId, stats: teamStats });
    }

    persistStats(customerId, tz);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
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
    };

    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction);
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });

    if (teamInfo.teamId) {
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction);
      teamStatsAnswer(customerId, teamInfo.teamId, call.id);
      const teamStats = getTeamStats(customerId, teamInfo.teamId);
      broadcastToTeam(customerId, teamInfo.teamId, { type: "call.started", call: callData, stats: teamStats });
      broadcast(customerId, { type: "team.stats", teamId: teamInfo.teamId, stats: teamStats });
    }

    persistStats(customerId, tz);
  }
}

function handleCallEnded(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  const teamInfo = extractTeamInfo(call);

  if (existing) {
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (teamInfo.agentId && !existing.agentId) { existing.agentId = teamInfo.agentId; existing.agentName = teamInfo.agentName; }

    if (existing.teamId && teamFirstDiscovered) {
      if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound");
      log(`Team discovered on call.ended [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
    }

    const outcomeStatus = call.outcome?.status;
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";

    if (isAnswered) {
      existing.status = "answered";
      statsAnswer(customerId, call.id);
      if (existing.teamId) teamStatsAnswer(customerId, existing.teamId, call.id);
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
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
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
    };
    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction);
    if (isAnswered) statsAnswer(customerId, call.id);
    statsEndCall(customerId, call.id, finalStatus, duration);

    if (teamInfo.teamId) {
      teamStatsNewCall(customerId, teamInfo.teamId, call.id, direction);
      if (isAnswered) teamStatsAnswer(customerId, teamInfo.teamId, call.id);
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

function handleCallNotAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  const teamInfo = extractTeamInfo(call);

  if (existing) {
    const teamFirstDiscovered = !!(teamInfo.teamId && !existing.teamId);
    if (teamInfo.teamId && !existing.teamId) { existing.teamId = teamInfo.teamId; existing.teamName = teamInfo.teamName; }
    if (existing.teamId && teamFirstDiscovered) {
      if (teamInfo.teamName) ensureTeamInDb(customerId, existing.teamId, teamInfo.teamName);
      teamStatsNewCall(customerId, existing.teamId, call.id, existing.direction || "inbound");
      log(`Team discovered on call.not_answered [${customerId}] team=${existing.teamId} (${teamInfo.teamName}), retroactively counted`, "webhook");
    }
    existing.status = "missed";
    statsEndCall(customerId, call.id, "missed", null);
    if (existing.teamId) teamStatsEndCall(customerId, existing.teamId, call.id, "missed", null);
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

  if (!sentiment) return;

  const existing = getCall(customerId, callId);
  if (existing && !existing.sentiment) {
    existing.sentiment = sentiment as CallData["sentiment"];
    statsSentiment(customerId, callId, sentiment);
    persistStats(customerId, tz);
    broadcast(customerId, { type: "sentiment.update", callId, sentiment, stats: getStats(customerId) });
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

  for (const agent of agents) {
    if (agent.availability.status === "ringing" && agent.availability.callId) {
      const existing = getCall(customerId, agent.availability.callId);
      if (existing && !existing.teamId) {
        existing.teamId = teamId;
        existing.teamName = summary.displayName;
        existing.agentId = agent.id;
        existing.agentName = agent.displayName;
        teamStatsNewCall(customerId, teamId, agent.availability.callId, existing.direction || "inbound");
        log(`Team linked via team.availability.ringing [${customerId}]: call=${agent.availability.callId} → team=${teamId} (${summary.displayName})`, "webhook");
        broadcastToTeam(customerId, teamId, {
          type: "call.started",
          call: existing,
          stats: getTeamStats(customerId, teamId),
        });
        broadcast(customerId, { type: "team.stats", teamId, stats: getTeamStats(customerId, teamId) });
        break;
      }
    }
  }

  const teamStats = getTeamStats(customerId, teamId);

  broadcastToTeam(customerId, teamId, {
    type: "team.availability",
    teamId,
    summary,
    agents,
    stats: teamStats,
  });

  broadcast(customerId, {
    type: "team.availability",
    teamId,
    summary,
    agents,
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

  const ringingCallId = updatedAgent.availability.callId;
  if (updatedAgent.availability.status === "ringing" && ringingCallId && affectedTeamIds.length > 0) {
    const existing = getCall(customerId, ringingCallId);
    if (existing && !existing.teamId) {
      const teamId = affectedTeamIds[0];
      const teamState = getTeamState(customerId, teamId);
      const teamName = teamState?.summary?.displayName || teamId;
      existing.teamId = teamId;
      existing.teamName = teamName;
      existing.agentId = user.id;
      existing.agentName = updatedAgent.displayName;
      ensureTeamInDb(customerId, teamId, teamName);
      teamStatsNewCall(customerId, teamId, ringingCallId, existing.direction || "inbound");
      const teamStats = getTeamStats(customerId, teamId);
      log(`Team linked via user.ringing [${customerId}]: call=${ringingCallId} → team=${teamId} (${teamName}), active=${teamStats.active} waiting=${teamStats.callsWaiting}`, "webhook");
      broadcastToTeam(customerId, teamId, {
        type: "call.started",
        call: existing,
        stats: teamStats,
      });
      broadcast(customerId, { type: "team.stats", teamId, stats: teamStats });
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
    }
  }

  if (affectedTeamIds.length > 0) {
    log(`User availability updated [${customerId}]: ${updatedAgent.displayName} → ${updatedAgent.availability.status} (${affectedTeamIds.length} teams affected, callId=${ringingCallId || "none"})`, "webhook");
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
