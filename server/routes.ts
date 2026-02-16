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
} from "./webhookState";
import type { CallData, Customer, AuthorizedUser } from "@shared/schema";
import { insertCustomerSchema, insertAuthorizedUserSchema } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth";
import { log } from "./index";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tenantWsClients = new Map<string, Set<WebSocket>>();
const globalWsClients = new Set<WebSocket>();

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
    createdAt: row.created_at,
  };
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

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname === "/ws/_spoke") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, "_spoke");
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
  });

  wss.on("connection", async (ws: WebSocket, _req: any, customerId: string) => {
    if (customerId === "_spoke") {
      log("Global Spoke wallboard connected", "ws");
      globalWsClients.add(ws);

      const customerList = await pool.query("SELECT id, name FROM customers WHERE active = true ORDER BY name");
      const customers = customerList.rows.map((r: any) => ({ id: r.id, name: r.name }));

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
      createdAt: row.created_at,
    }));
    res.json(customers);
  });

  app.post("/api/admin/customers", isAuthenticated, isAuthorizedAdmin, async (req, res) => {
    const parsed = insertCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { id, name, active, ipAllowlist, timezone } = parsed.data;

    try {
      await pool.query(
        "INSERT INTO customers (id, name, active, ip_allowlist, timezone) VALUES ($1, $2, $3, $4, $5)",
        [id, name, active, ipAllowlist, timezone]
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

  return httpServer;
}

// --- Webhook handlers (all tenant-scoped) ---

function handleCallStarted(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call || call.isInternal) return;

  if (getCall(customerId, call.id)) return;

  const isInbound = call.direction === "inbound";
  const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
  const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
  const direction: "inbound" | "outbound" = call.direction;

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
  };

  addCall(customerId, callData);
  statsNewCall(customerId, call.id, direction);
  broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
  persistStats(customerId, tz);
}

function handleCallAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  if (existing) {
    existing.status = "answered";
    existing.answeredAt = call.answeredAt;
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.answered", callId: call.id, stats: getStats(customerId) });
    persistStats(customerId, tz);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const direction: "inbound" | "outbound" = call.direction || "inbound";

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
    };

    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction);
    statsAnswer(customerId, call.id);
    broadcast(customerId, { type: "call.started", call: callData, stats: getStats(customerId) });
    persistStats(customerId, tz);
  }
}

function handleCallEnded(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);

  if (existing) {
    const outcomeStatus = call.outcome?.status;
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";

    if (isAnswered) {
      existing.status = "answered";
      statsAnswer(customerId, call.id);
    } else if (existing.status === "active") {
      existing.status = "missed";
    }

    const duration = call.duration ? Math.round(call.duration / 1000) : null;
    existing.duration = duration || existing.duration;
    existing.durationText = call.durationText || existing.durationText;
    statsEndCall(customerId, call.id, existing.status, duration);
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
    };
    addCall(customerId, callData);
    statsNewCall(customerId, call.id, direction);
    if (isAnswered) statsAnswer(customerId, call.id);
    statsEndCall(customerId, call.id, finalStatus, duration);
  }

  const finalCall = getCall(customerId, call.id);
  if (finalCall) {
    persistStats(customerId, tz);
    broadcast(customerId, { type: "call.ended", call: finalCall, stats: getStats(customerId) });
  }
}

function handleCallNotAnswered(customerId: string, event: any, tz: string) {
  const call = event.data?.call;
  if (!call) return;
  const existing = getCall(customerId, call.id);
  if (existing) {
    existing.status = "missed";
    statsEndCall(customerId, call.id, "missed", null);
    persistStats(customerId, tz);
  }
  broadcast(customerId, { type: "call.not_answered", callId: call.id, stats: getStats(customerId) });
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
