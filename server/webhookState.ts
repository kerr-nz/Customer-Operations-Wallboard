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

function todayDate(): string {
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

export function statsAnswer(customerId: string, callId: string) {
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  if (flags.answer) return;
  flags.answer = true;
  tenant.dailyStats.answered++;
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

export async function loadFromDb(customerId: string) {
  try {
    const today = todayDate();
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
    const result = await pool.query("SELECT id FROM customers WHERE active = true");
    for (const row of result.rows) {
      await loadFromDb(row.id);
    }
    console.log(`[db] Loaded stats for ${result.rows.length} active customers`);
  } catch (err) {
    console.error("[db] Failed to load active customers:", err);
  }
}

export async function persistStats(customerId: string) {
  try {
    const today = todayDate();
    const s = getTenant(customerId).dailyStats;
    await pool.query(
      `INSERT INTO wallboard_stats (customer_id, date, total, active, inbound, outbound, answered, missed, happy, normal, angry, total_duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (customer_id, date) DO UPDATE SET
         total = EXCLUDED.total,
         active = EXCLUDED.active,
         inbound = EXCLUDED.inbound,
         outbound = EXCLUDED.outbound,
         answered = EXCLUDED.answered,
         missed = EXCLUDED.missed,
         happy = EXCLUDED.happy,
         normal = EXCLUDED.normal,
         angry = EXCLUDED.angry,
         total_duration = EXCLUDED.total_duration`,
      [customerId, today, s.total, s.active, s.inbound, s.outbound, s.answered, s.missed, s.happy, s.normal, s.angry, s.totalDuration]
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

export async function resetTenant(customerId: string) {
  const tenant = getTenant(customerId);
  tenant.todayCalls.clear();
  tenant.countedFlags.clear();
  tenant.dailyStats = emptyStats();
  try {
    const today = todayDate();
    await pool.query("DELETE FROM wallboard_stats WHERE customer_id = $1 AND date = $2", [customerId, today]);
  } catch (err) {
    console.error(`[db] Failed to reset data for ${customerId}:`, err);
  }
}

export function getStats(customerId: string): DailyStats {
  return { ...getTenant(customerId).dailyStats };
}

export function getRecentCalls(customerId: string, limit = 30): CallData[] {
  return Array.from(getTenant(customerId).todayCalls.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getTodayCalls(customerId: string): Map<string, CallData> {
  return getTenant(customerId).todayCalls;
}
