import type { CallData, DailyStats, TeamAgent, TeamSummary, TeamStats, TeamState } from "@shared/schema";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const MAX_RECENT_CALLS = 100;

interface InternalTeamState {
  summary: TeamSummary;
  agents: TeamAgent[];
  stats: TeamStats;
  callIds: Set<string>;
  countedFlags: Map<string, { answer: boolean; missed: boolean; end: boolean }>;
  waitingCalls: Map<string, number>;
}

interface TenantState {
  todayCalls: Map<string, CallData>;
  countedFlags: Map<string, { answer: boolean; missed: boolean; end: boolean; sentiment: boolean }>;
  dailyStats: DailyStats;
  teams: Map<string, InternalTeamState>;
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

function emptyTeamStats(): TeamStats {
  return {
    total: 0, active: 0, callsWaiting: 0, inbound: 0, outbound: 0,
    answered: 0, missed: 0,
    inboundAnswered: 0, outboundAnswered: 0,
    totalDuration: 0, totalWaitTime: 0, answeredWithWait: 0,
    liveWaitAvg: 0,
  };
}

function getTenant(customerId: string): TenantState {
  if (!tenants.has(customerId)) {
    tenants.set(customerId, {
      todayCalls: new Map(),
      countedFlags: new Map(),
      dailyStats: emptyStats(),
      teams: new Map(),
    });
  }
  return tenants.get(customerId)!;
}

function getTeam(tenant: TenantState, teamId: string): InternalTeamState {
  if (!tenant.teams.has(teamId)) {
    tenant.teams.set(teamId, {
      summary: { id: teamId, displayName: teamId, totalMembers: 0, totalAvailable: 0, status: "unknown", availabilitySummary: "" },
      agents: [],
      stats: emptyTeamStats(),
      callIds: new Set(),
      countedFlags: new Map(),
      waitingCalls: new Map(),
    });
  }
  return tenant.teams.get(teamId)!;
}

function getTeamFlags(team: InternalTeamState, callId: string) {
  if (!team.countedFlags.has(callId)) {
    team.countedFlags.set(callId, { answer: false, missed: false, end: false });
  }
  return team.countedFlags.get(callId)!;
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
    await loadTeamStatsFromDb(customerId, timezone);
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

export async function persistTeamStats(customerId: string, timezone?: string) {
  try {
    const today = todayDate(timezone);
    const tenant = getTenant(customerId);
    for (const [teamId, team] of tenant.teams) {
      const s = team.stats;
      await pool.query(
        `INSERT INTO team_daily_stats (customer_id, team_id, date, total, inbound, outbound, answered, missed, inbound_answered, outbound_answered, total_duration, total_wait_time, answered_with_wait)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (customer_id, team_id, date) DO UPDATE SET
           total = EXCLUDED.total,
           inbound = EXCLUDED.inbound,
           outbound = EXCLUDED.outbound,
           answered = EXCLUDED.answered,
           missed = EXCLUDED.missed,
           inbound_answered = EXCLUDED.inbound_answered,
           outbound_answered = EXCLUDED.outbound_answered,
           total_duration = EXCLUDED.total_duration,
           total_wait_time = EXCLUDED.total_wait_time,
           answered_with_wait = EXCLUDED.answered_with_wait`,
        [customerId, teamId, today, s.total, s.inbound, s.outbound, s.answered, s.missed, s.inboundAnswered, s.outboundAnswered, s.totalDuration, s.totalWaitTime, s.answeredWithWait]
      );
    }
  } catch (err) {
    console.error(`[db] Failed to persist team stats for ${customerId}:`, err);
  }
}

export async function loadTeamStatsFromDb(customerId: string, timezone?: string) {
  try {
    const today = todayDate(timezone);
    const tenant = getTenant(customerId);
    const result = await pool.query(
      "SELECT * FROM team_daily_stats WHERE customer_id = $1 AND date = $2",
      [customerId, today]
    );
    for (const row of result.rows) {
      const team = getTeam(tenant, row.team_id);
      team.stats.total = row.total;
      team.stats.active = 0;
      team.stats.callsWaiting = 0;
      team.stats.inbound = row.inbound;
      team.stats.outbound = row.outbound;
      team.stats.answered = row.answered;
      team.stats.missed = row.missed;
      team.stats.inboundAnswered = row.inbound_answered || 0;
      team.stats.outboundAnswered = row.outbound_answered || 0;
      team.stats.totalDuration = row.total_duration;
      team.stats.totalWaitTime = row.total_wait_time || 0;
      team.stats.answeredWithWait = row.answered_with_wait || 0;
    }
    if (result.rows.length > 0) {
      console.log(`[db] Loaded team stats for ${customerId}: ${result.rows.length} teams`);
    }
  } catch (err) {
    console.error(`[db] Failed to load team stats for ${customerId}:`, err);
  }
}

export function getTeamLiveWaitAvg(customerId: string, teamId: string): number {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team || team.waitingCalls.size === 0) return 0;
  const now = Date.now();
  let totalWait = 0;
  for (const startTime of team.waitingCalls.values()) {
    totalWait += (now - startTime) / 1000;
  }
  return Math.round(totalWait / team.waitingCalls.size);
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
    await persistTeamStats(customerId, timezone);
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
  tenant.teams.clear();
  try {
    const today = todayDate(timezone);
    await pool.query("DELETE FROM wallboard_stats WHERE customer_id = $1 AND date = $2", [customerId, today]);
    await pool.query("DELETE FROM team_daily_stats WHERE customer_id = $1 AND date = $2", [customerId, today]);
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

export function teamStatsNewCall(customerId: string, teamId: string, callId: string, direction: "inbound" | "outbound") {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  getTeamFlags(team, callId);
  team.callIds.add(callId);
  team.stats.total++;
  team.stats.active++;
  if (direction === "inbound") team.stats.inbound++;
  else team.stats.outbound++;
}

export function teamStatsAnswer(customerId: string, teamId: string, callId: string, direction?: "inbound" | "outbound") {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  const flags = getTeamFlags(team, callId);
  if (flags.answer) return;
  flags.answer = true;
  team.stats.answered++;
  team.waitingCalls.delete(callId);
  const call = tenant.todayCalls.get(callId);
  const dir = direction || call?.direction;
  if (dir === "inbound") team.stats.inboundAnswered++;
  else if (dir === "outbound") team.stats.outboundAnswered++;
  if (flags.missed) {
    team.stats.missed--;
    flags.missed = false;
  }
  if (call?.startedAt && call?.answeredAt) {
    const waitMs = new Date(call.answeredAt).getTime() - new Date(call.startedAt).getTime();
    if (waitMs > 0) {
      team.stats.totalWaitTime += Math.round(waitMs / 1000);
      team.stats.answeredWithWait++;
    }
  }
}

export function teamStatsEndCall(customerId: string, teamId: string, callId: string, finalStatus: string, duration: number | null) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  const flags = getTeamFlags(team, callId);
  if (!flags.end) {
    flags.end = true;
    team.stats.active = Math.max(0, team.stats.active - 1);
    team.waitingCalls.delete(callId);
  }
  if (finalStatus === "missed" && !flags.missed && !flags.answer) {
    flags.missed = true;
    team.stats.missed++;
  }
  if (finalStatus === "answered" && !flags.answer) {
    flags.answer = true;
    team.stats.answered++;
    const call = tenant.todayCalls.get(callId);
    const dir = call?.direction;
    if (dir === "inbound") team.stats.inboundAnswered++;
    else if (dir === "outbound") team.stats.outboundAnswered++;
  }
  if (duration && duration > 0) {
    team.stats.totalDuration += duration;
  }
}

export function updateTeamAvailability(customerId: string, teamId: string, summary: TeamSummary, agents: TeamAgent[]) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  team.summary = summary;
  team.agents = agents;

  const ringingCallIds = new Set<string>();
  for (const agent of agents) {
    const callId = agent.availability.callId;
    if (!callId) continue;
    if (agent.availability.status === "ringing") ringingCallIds.add(callId);
  }
  team.stats.callsWaiting = ringingCallIds.size;

  Array.from(ringingCallIds).forEach(callId => {
    if (!team.waitingCalls.has(callId)) {
      team.waitingCalls.set(callId, Date.now());
    }
  });
  Array.from(team.waitingCalls.keys()).forEach(callId => {
    if (!ringingCallIds.has(callId)) {
      team.waitingCalls.delete(callId);
    }
  });
}

export function updateUserAvailabilityAcrossTeams(
  customerId: string,
  userId: string,
  updatedAgent: Partial<TeamAgent> & { availability: TeamAgent["availability"]; loginStatus: TeamAgent["loginStatus"] },
): string[] {
  const tenant = getTenant(customerId);
  const affectedTeamIds: string[] = [];

  for (const [teamId, team] of tenant.teams) {
    const idx = team.agents.findIndex(a => a.id === userId);
    if (idx !== -1) {
      const existing = team.agents[idx];
      team.agents[idx] = {
        ...existing,
        ...updatedAgent,
        id: userId,
        displayName: updatedAgent.displayName || existing.displayName,
        firstName: updatedAgent.firstName || existing.firstName,
        lastName: updatedAgent.lastName || existing.lastName,
        email: updatedAgent.email || existing.email,
      };

      const availableCount = team.agents.filter(
        a => a.loginStatus === "loggedIn" && a.availability.status === "available"
      ).length;
      team.summary.totalAvailable = availableCount;
      team.summary.status = availableCount > 0 ? "available" : "unavailable";
      team.summary.availabilitySummary = `${availableCount} of ${team.summary.totalMembers} available`;

      const ringingCallIds = new Set<string>();
      for (const a of team.agents) {
        if (a.availability.status === "ringing" && a.availability.callId) {
          ringingCallIds.add(a.availability.callId);
        }
      }
      team.stats.callsWaiting = ringingCallIds.size;

      Array.from(ringingCallIds).forEach(cid => {
        if (!team.waitingCalls.has(cid)) team.waitingCalls.set(cid, Date.now());
      });
      Array.from(team.waitingCalls.keys()).forEach(cid => {
        if (!ringingCallIds.has(cid)) team.waitingCalls.delete(cid);
      });

      affectedTeamIds.push(teamId);
    }
  }

  return affectedTeamIds;
}

export function getTeamState(customerId: string, teamId: string): TeamState | null {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return null;
  return {
    summary: { ...team.summary },
    agents: [...team.agents],
    stats: { ...team.stats },
  };
}

export function getAllTeamSummaries(customerId: string): TeamSummary[] {
  const tenant = getTenant(customerId);
  return Array.from(tenant.teams.values()).map(t => ({ ...t.summary }));
}

export function getTeamRecentCalls(customerId: string, teamId: string, limit = 50): CallData[] {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return [];
  const calls: CallData[] = [];
  for (const callId of team.callIds) {
    const call = tenant.todayCalls.get(callId);
    if (call) calls.push(call);
  }
  return calls.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export function getAllTeamStats(customerId: string): Record<string, TeamStats> {
  const tenant = getTenant(customerId);
  const result: Record<string, TeamStats> = {};
  for (const [teamId, team] of tenant.teams) {
    result[teamId] = { ...team.stats, liveWaitAvg: getTeamLiveWaitAvg(customerId, teamId) };
  }
  return result;
}

export function getTeamStats(customerId: string, teamId: string): TeamStats {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return emptyTeamStats();
  return { ...team.stats, liveWaitAvg: getTeamLiveWaitAvg(customerId, teamId) };
}
