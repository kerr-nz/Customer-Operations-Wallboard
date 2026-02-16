import type { CallData, DailyStats } from "@shared/schema";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const MAX_RECENT_CALLS = 100;

interface TenantState {
  todayCalls: Map<string, CallData>;
  countedFlags: Map<string, { answer: boolean; missed: boolean; end: boolean; sentiment: boolean }>;
  dailyStats: DailyStats;
}

const tenants = new Map<string, TenantState>();

function emptyStats(): DailyStats {
  return {
    total: 0, active: 0, inbound: 0, outbound: 0,
    answered: 0, missed: 0,
    inboundAnswered: 0, outboundAnswered: 0,
    happy: 0, normal: 0, angry: 0,
    totalDuration: 0,
  };
}

function getTenant(customerId: string): TenantState {
  if (!tenants.has(customerId)) {
    tenants.set(customerId, {
      todayCalls: new Map(),
      countedFlags: new Map(),
      dailyStats: emptyStats(),
    });
  }
  return tenants.get(customerId)!;
}

function getFlags(tenant: TenantState, callId: string) {
  if (!tenant.countedFlags.has(callId)) {
    tenant.countedFlags.set(callId, { answer: false, missed: false, end: false, sentiment: false });
  }
  return tenant.countedFlags.get(callId)!;
}

function todayDate(timezone?: string): string {
  if (timezone && timezone !== "UTC") {
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
  return new Date().toISOString().slice(0, 10);
}

function trimOldCalls(tenant: TenantState) {
  if (tenant.todayCalls.size <= MAX_RECENT_CALLS) return;
  const sorted = Array.from(tenant.todayCalls.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp);
  const toKeep = new Set<string>();
  for (const [id, call] of sorted) {
    if (call.status === "active" || toKeep.size < MAX_RECENT_CALLS) {
      toKeep.add(id);
    }
  }
  for (const [id] of sorted) {
    if (!toKeep.has(id)) {
      tenant.todayCalls.delete(id);
      tenant.countedFlags.delete(id);
    }
  }
}

export function addCall(customerId: string, call: CallData) {
  const tenant = getTenant(customerId);
  tenant.todayCalls.set(call.id, call);
  trimOldCalls(tenant);
}

export function getCall(customerId: string, callId: string): CallData | undefined {
  return getTenant(customerId).todayCalls.get(callId);
}

export function statsNewCall(customerId: string, callId: string, direction: "inbound" | "outbound") {
  const tenant = getTenant(customerId);
  getFlags(tenant, callId);
  tenant.dailyStats.total++;
  tenant.dailyStats.active++;
  if (direction === "inbound") tenant.dailyStats.inbound++;
  else tenant.dailyStats.outbound++;
}

export function statsAnswer(customerId: string, callId: string, direction?: "inbound" | "outbound") {
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  if (flags.answer) return;
  flags.answer = true;
  tenant.dailyStats.answered++;
  const dir = direction || tenant.todayCalls.get(callId)?.direction;
  if (dir === "inbound") tenant.dailyStats.inboundAnswered++;
  else if (dir === "outbound") tenant.dailyStats.outboundAnswered++;
  if (flags.missed) {
    tenant.dailyStats.missed--;
    flags.missed = false;
  }
}

export function statsEndCall(customerId: string, callId: string, finalStatus: string, duration: number | null) {
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  if (!flags.end) {
    flags.end = true;
    tenant.dailyStats.active = Math.max(0, tenant.dailyStats.active - 1);
  }
  if (finalStatus === "missed" && !flags.missed && !flags.answer) {
    flags.missed = true;
    tenant.dailyStats.missed++;
  }
  if (finalStatus === "answered" && !flags.answer) {
    flags.answer = true;
    tenant.dailyStats.answered++;
    const dir = tenant.todayCalls.get(callId)?.direction;
    if (dir === "inbound") tenant.dailyStats.inboundAnswered++;
    else if (dir === "outbound") tenant.dailyStats.outboundAnswered++;
  }
  if (duration && duration > 0) {
    tenant.dailyStats.totalDuration += duration;
  }
}

export function statsSentiment(customerId: string, callId: string, sentiment: string) {
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  if (flags.sentiment) return;
  flags.sentiment = true;
  const key = sentiment.toLowerCase();
  if (key === "happy") tenant.dailyStats.happy++;
  else if (key === "angry") tenant.dailyStats.angry++;
  else tenant.dailyStats.normal++;
}

export async function loadFromDb(customerId: string, timezone?: string) {
  try {
    const today = todayDate(timezone);
    const tenant = getTenant(customerId);

    const statsResult = await pool.query(
      "SELECT * FROM wallboard_stats WHERE customer_id = $1 AND date = $2",
      [customerId, today]
    );

    if (statsResult.rows.length > 0) {
      const row = statsResult.rows[0];
      tenant.dailyStats.total = row.total;
      tenant.dailyStats.active = 0;
      tenant.dailyStats.inbound = row.inbound;
      tenant.dailyStats.outbound = row.outbound;
      tenant.dailyStats.answered = row.answered;
      tenant.dailyStats.missed = row.missed;
      tenant.dailyStats.inboundAnswered = row.inbound_answered || 0;
      tenant.dailyStats.outboundAnswered = row.outbound_answered || 0;
      tenant.dailyStats.happy = row.happy;
      tenant.dailyStats.normal = row.normal;
      tenant.dailyStats.angry = row.angry;
      tenant.dailyStats.totalDuration = row.total_duration;
    }

    tenant.todayCalls.clear();
    tenant.countedFlags.clear();

    await pool.query(
      "UPDATE wallboard_stats SET active = 0 WHERE customer_id = $1 AND date = $2",
      [customerId, today]
    );

    console.log(`[db] Loaded stats for ${customerId} on ${today} (total: ${tenant.dailyStats.total})`);
  } catch (err) {
    console.error(`[db] Failed to load from database for ${customerId}:`, err);
  }
}

export async function loadAllActiveCustomers() {
  try {
    const spokeSettingsResult = await pool.query("SELECT value FROM app_settings WHERE key = 'spoke_timezone'");
    const spokeTz = spokeSettingsResult.rows.length > 0 ? spokeSettingsResult.rows[0].value : "UTC";
    const spokeLocalDate = todayDate(spokeTz);

    const spokeResetResult = await pool.query("SELECT value FROM app_settings WHERE key = 'spoke_last_reset_date'");
    const spokeLastReset = spokeResetResult.rows.length > 0 ? spokeResetResult.rows[0].value : null;

    const needsGlobalReset = !spokeLastReset || spokeLastReset < spokeLocalDate;

    if (needsGlobalReset) {
      console.log(`[db] Global Spoke reset on startup (timezone: ${spokeTz}, local date: ${spokeLocalDate}, last reset: ${spokeLastReset || "never"})`);
    }

    const result = await pool.query("SELECT id, timezone, last_reset_date FROM customers WHERE active = true");
    for (const row of result.rows) {
      const tz = row.timezone || "UTC";
      const localToday = todayDate(tz);
      const lastReset = row.last_reset_date;

      if (needsGlobalReset || (lastReset && lastReset < localToday)) {
        console.log(`[db] Stale data for ${row.id}: last reset ${lastReset}, local today ${localToday} — resetting`);
        await resetTenant(row.id, tz);
        await pool.query("UPDATE customers SET last_reset_date = $1 WHERE id = $2", [localToday, row.id]);
      }

      await loadFromDb(row.id, tz);
    }

    if (needsGlobalReset) {
      await pool.query(
        "INSERT INTO app_settings (key, value) VALUES ('spoke_last_reset_date', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [spokeLocalDate]
      );
    }

    console.log(`[db] Loaded stats for ${result.rows.length} active customers`);
  } catch (err) {
    console.error("[db] Failed to load active customers:", err);
  }
}

export async function persistStats(customerId: string, timezone?: string) {
  try {
    const today = todayDate(timezone);
    const s = getTenant(customerId).dailyStats;
    await pool.query(
      `INSERT INTO wallboard_stats (customer_id, date, total, active, inbound, outbound, answered, missed, inbound_answered, outbound_answered, happy, normal, angry, total_duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (customer_id, date) DO UPDATE SET
         total = EXCLUDED.total,
         active = EXCLUDED.active,
         inbound = EXCLUDED.inbound,
         outbound = EXCLUDED.outbound,
         answered = EXCLUDED.answered,
         missed = EXCLUDED.missed,
         inbound_answered = EXCLUDED.inbound_answered,
         outbound_answered = EXCLUDED.outbound_answered,
         happy = EXCLUDED.happy,
         normal = EXCLUDED.normal,
         angry = EXCLUDED.angry,
         total_duration = EXCLUDED.total_duration`,
      [customerId, today, s.total, s.active, s.inbound, s.outbound, s.answered, s.missed, s.inboundAnswered, s.outboundAnswered, s.happy, s.normal, s.angry, s.totalDuration]
    );
  } catch (err) {
    console.error(`[db] Failed to persist stats for ${customerId}:`, err);
  }
}

export async function resetAllTenants() {
  tenants.clear();
  try {
    const today = todayDate();
    await pool.query("DELETE FROM wallboard_stats WHERE date < $1", [today]);
  } catch (err) {
    console.error("[db] Failed to clean old data:", err);
  }
}

export async function resetTenant(customerId: string, timezone?: string) {
  const tenant = getTenant(customerId);
  tenant.todayCalls.clear();
  tenant.countedFlags.clear();
  tenant.dailyStats = emptyStats();
  try {
    const today = todayDate(timezone);
    await pool.query("DELETE FROM wallboard_stats WHERE customer_id = $1 AND date = $2", [customerId, today]);
  } catch (err) {
    console.error(`[db] Failed to reset data for ${customerId}:`, err);
  }
}

export function getStats(customerId: string): DailyStats {
  return { ...getTenant(customerId).dailyStats };
}

export function getGlobalStats(): DailyStats {
  const agg: DailyStats = emptyStats();
  Array.from(tenants.values()).forEach((tenant) => {
    const s = tenant.dailyStats;
    agg.total += s.total;
    agg.active += s.active;
    agg.inbound += s.inbound;
    agg.outbound += s.outbound;
    agg.answered += s.answered;
    agg.missed += s.missed;
    agg.inboundAnswered += s.inboundAnswered;
    agg.outboundAnswered += s.outboundAnswered;
    agg.happy += s.happy;
    agg.normal += s.normal;
    agg.angry += s.angry;
    agg.totalDuration += s.totalDuration;
  });
  return agg;
}

export function getGlobalRecentCalls(limit = 50): (CallData & { customerId: string })[] {
  const all: (CallData & { customerId: string })[] = [];
  Array.from(tenants.entries()).forEach(([customerId, tenant]) => {
    Array.from(tenant.todayCalls.values()).forEach((call) => {
      all.push({ ...call, customerId });
    });
  });
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export function getAllTenantIds(): string[] {
  return Array.from(tenants.keys());
}

export function getRecentCalls(customerId: string, limit = 30): CallData[] {
  return Array.from(getTenant(customerId).todayCalls.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getTodayCalls(customerId: string): Map<string, CallData> {
  return getTenant(customerId).todayCalls;
}
