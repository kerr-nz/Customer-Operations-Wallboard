import type { CallData, DailyStats, TeamAgent, TeamSummary, TeamStats, TeamState } from "@shared/schema";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const MAX_RECENT_CALLS = 100;
export const STALE_CALL_MS = 90 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 60 * 1000;
export const COUNTED_FLAGS_CAP = 50_000;
// How long a Team Call data action that arrives BEFORE its call.started
// webhook is held before being discarded (ordering is not guaranteed).
export const PENDING_TEAM_ASSIGNMENT_TTL_MS = 2 * 60 * 1000;

interface InternalTeamState {
  summary: TeamSummary;
  agents: TeamAgent[];
  stats: TeamStats;
  callIds: Set<string>;
  countedFlags: Map<string, { answer: boolean; missed: boolean; end: boolean; durationCounted: boolean; waitCounted: boolean; waitSeconds: number }>;
  waitingCalls: Map<string, number>;
  activeCallIds: Map<string, number>;
}

interface TenantState {
  todayCalls: Map<string, CallData>;
  countedFlags: Map<string, { answer: boolean; missed: boolean; end: boolean; sentiment: boolean; durationCounted: boolean; endedAtMs?: number }>;
  dailyStats: DailyStats;
  teams: Map<string, InternalTeamState>;
  activeCallIds: Map<string, number>;
  // Live inbound calls that started WITHOUT a directoryTarget (i.e. ringing
  // for a queue rather than an individual user). Ephemeral — never persisted.
  queueRingingCallIds: Set<string>;
  // ALL live calls that have started but not yet been answered or ended
  // (any direction). Ephemeral — never persisted.
  ringingCallIds: Set<string>;
  // Team Call data actions that arrived before their call.started webhook.
  // Held briefly (PENDING_TEAM_ASSIGNMENT_TTL_MS) and applied when the call
  // appears. Ephemeral — never persisted.
  pendingTeamAssignments: Map<string, { teamId: string; teamName?: string; expiresAt: number }>;
}

const tenants = new Map<string, TenantState>();

let lateNewCallSkipsSinceBoot = 0;

// --- Canonical live predicate -----------------------------------------------
// THE single definition of "live call" used by every KPI, ticker, and roster
// view at every level (team, group, customer, global). A call is live while it
// is ringing (status "active") or connected (answered with no final duration).
// Frontends use the identical predicate for ticker rendering, so a KPI number
// and the ticker it sits above can never disagree by construction.
export function isLiveCall(c: CallData): boolean {
  return c.status === "active" || (c.status === "answered" && c.duration == null);
}

function liveCalls(tenant: TenantState): CallData[] {
  const out: CallData[] = [];
  for (const c of tenant.todayCalls.values()) {
    if (isLiveCall(c)) out.push(c);
  }
  return out;
}

// Live calls currently attributed to a team (call.teamId is the canonical
// CURRENT owner; rollovers move it, so the losing team's slice empties the
// moment the call moves on).
function teamLiveSlice(tenant: TenantState, teamId: string): CallData[] {
  const out: CallData[] = [];
  for (const c of tenant.todayCalls.values()) {
    if (isLiveCall(c) && c.teamId === teamId) out.push(c);
  }
  return out;
}


function emptyStats(): DailyStats {
  return {
    total: 0, active: 0, inbound: 0, outbound: 0,
    answered: 0, missed: 0,
    inboundAnswered: 0, outboundAnswered: 0,
    positive: 0, neutral: 0, negative: 0,
    totalDuration: 0,
    inboundTotalDuration: 0, inboundDurationCount: 0,
    outboundTotalDuration: 0, outboundDurationCount: 0,
    avgCallDurationInbound: 0, avgCallDurationOutbound: 0,
  };
}

function emptyTeamStats(): TeamStats {
  return {
    total: 0, active: 0, ringing: 0, talking: 0, inbound: 0, outbound: 0,
    answered: 0, missed: 0,
    inboundAnswered: 0, outboundAnswered: 0,
    totalDuration: 0, totalWaitTime: 0, answeredWithWait: 0,
    liveWaitAvg: 0,
    inboundTotalDuration: 0, inboundDurationCount: 0,
    outboundTotalDuration: 0, outboundDurationCount: 0,
    avgCallDurationInbound: 0, avgCallDurationOutbound: 0,
  };
}

function getTenant(customerId: string): TenantState {
  if (!tenants.has(customerId)) {
    tenants.set(customerId, {
      todayCalls: new Map(),
      countedFlags: new Map(),
      dailyStats: emptyStats(),
      teams: new Map(),
      activeCallIds: new Map(),
      queueRingingCallIds: new Set(),
      ringingCallIds: new Set(),
      pendingTeamAssignments: new Map(),
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
      activeCallIds: new Map(),
    });
  }
  return tenant.teams.get(teamId)!;
}

function getTeamFlags(team: InternalTeamState, callId: string) {
  if (!team.countedFlags.has(callId)) {
    team.countedFlags.set(callId, { answer: false, missed: false, end: false, durationCounted: false, waitCounted: false, waitSeconds: 0 });
  }
  return team.countedFlags.get(callId)!;
}

function getFlags(tenant: TenantState, callId: string) {
  if (!tenant.countedFlags.has(callId)) {
    tenant.countedFlags.set(callId, { answer: false, missed: false, end: false, sentiment: false, durationCounted: false });
  }
  return tenant.countedFlags.get(callId)!;
}

function evictOldFlagsTenant(tenant: TenantState) {
  if (tenant.countedFlags.size <= COUNTED_FLAGS_CAP) return;
  const toRemove = tenant.countedFlags.size - COUNTED_FLAGS_CAP;
  let removed = 0;
  for (const [id, flags] of tenant.countedFlags) {
    if (removed >= toRemove) break;
    if (flags.end && !tenant.activeCallIds.has(id) && !tenant.todayCalls.has(id)) {
      tenant.countedFlags.delete(id);
      removed++;
    }
  }
}

function evictOldFlagsTeam(team: InternalTeamState) {
  if (team.countedFlags.size <= COUNTED_FLAGS_CAP) return;
  const toRemove = team.countedFlags.size - COUNTED_FLAGS_CAP;
  let removed = 0;
  for (const [id, flags] of team.countedFlags) {
    if (removed >= toRemove) break;
    if (flags.end && !team.activeCallIds.has(id) && !team.callIds.has(id)) {
      team.countedFlags.delete(id);
      removed++;
    }
  }
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
    // Live calls (ringing OR connected) are never evicted — evicting a live
    // call would make the ticker disagree with the KPIs derived from it.
    if (isLiveCall(call) || toKeep.size < MAX_RECENT_CALLS) {
      toKeep.add(id);
    }
  }
  for (const [id] of sorted) {
    if (!toKeep.has(id)) {
      tenant.todayCalls.delete(id);
      // Note: countedFlags retention is decoupled from buffer eviction (drift fix);
      // entries are evicted by evictOldFlagsTenant() with safe-guards.
    }
  }
}

export function addCall(customerId: string, call: CallData) {
  const tenant = getTenant(customerId);
  // Ghost guard: a replayed call.started for a call already ended at the
  // tenant level must not resurrect a live-looking call object (KPIs are
  // derived from these objects). Updates to a call still in the buffer pass
  // through unchanged.
  if (!tenant.todayCalls.has(call.id) && tenant.countedFlags.get(call.id)?.end === true) {
    return;
  }
  tenant.todayCalls.set(call.id, call);
  trimOldCalls(tenant);
}

export function getCall(customerId: string, callId: string): CallData | undefined {
  return getTenant(customerId).todayCalls.get(callId);
}

export function isTenantCallEnded(customerId: string, callId: string): boolean {
  const tenant = getTenant(customerId);
  return tenant.countedFlags.get(callId)?.end === true;
}

export function isTeamCallEnded(customerId: string, teamId: string, callId: string): boolean {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  return team?.countedFlags.get(callId)?.end === true;
}

// Returns the ms timestamp when the call was ended at the tenant level, or
// null if the call has not ended (or its flags were evicted). Used to gate
// call revival: only a data action arriving shortly after a premature
// call.not_answered is treated as rollover evidence.
export function getTenantCallEndedAt(customerId: string, callId: string): number | null {
  const tenant = getTenant(customerId);
  const flags = tenant.countedFlags.get(callId);
  if (!flags?.end) return null;
  return flags.endedAtMs ?? null;
}

// True when the given team has (or had) this call in its queue — proof of
// ownership before crediting the team with a miss on out-of-order events.
export function teamOwnsCall(customerId: string, teamId: string, callId: string): boolean {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return false;
  return team.activeCallIds.has(callId) || team.callIds.has(callId);
}

export function getLateNewCallSkipsSinceBoot(): number {
  return lateNewCallSkipsSinceBoot;
}

export function statsNewCall(customerId: string, callId: string, direction: "inbound" | "outbound", startedAt?: number, queueBound?: boolean) {
  const tenant = getTenant(customerId);
  const existingFlags = tenant.countedFlags.get(callId);
  if (existingFlags?.end) {
    lateNewCallSkipsSinceBoot++;
    if (lateNewCallSkipsSinceBoot % 50 === 0 || lateNewCallSkipsSinceBoot === 1) {
      console.log(`[drift] late statsNewCall skipped (count=${lateNewCallSkipsSinceBoot}) callId=${callId} customer=${customerId}`);
    }
    return;
  }
  const flags = getFlags(tenant, callId);
  tenant.activeCallIds.set(callId, startedAt ?? Date.now());
  // Only mark as ringing if we haven't already seen the answer event
  // (webhooks can arrive out of order).
  if (!flags.answer) tenant.ringingCallIds.add(callId);
  if (queueBound && direction === "inbound") tenant.queueRingingCallIds.add(callId);
  tenant.dailyStats.total++;
  if (direction === "inbound") tenant.dailyStats.inbound++;
  else tenant.dailyStats.outbound++;
  tenant.dailyStats.active = tenant.activeCallIds.size;
}

export function statsAnswer(customerId: string, callId: string, direction?: "inbound" | "outbound") {
  const tenant = getTenant(customerId);
  tenant.queueRingingCallIds.delete(callId);
  tenant.ringingCallIds.delete(callId);
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
  tenant.activeCallIds.delete(callId);
  tenant.queueRingingCallIds.delete(callId);
  tenant.ringingCallIds.delete(callId);
  tenant.dailyStats.active = tenant.activeCallIds.size;
  flags.end = true;
  flags.endedAtMs = Date.now();
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
  if (duration && duration > 0 && !flags.durationCounted && (finalStatus === "answered" || flags.answer)) {
    flags.durationCounted = true;
    tenant.dailyStats.totalDuration += duration;
    const dir = tenant.todayCalls.get(callId)?.direction;
    if (dir === "inbound") {
      tenant.dailyStats.inboundTotalDuration += duration;
      tenant.dailyStats.inboundDurationCount++;
    } else if (dir === "outbound") {
      tenant.dailyStats.outboundTotalDuration += duration;
      tenant.dailyStats.outboundDurationCount++;
    }
  }
  evictOldFlagsTenant(tenant);
}

// Revives a call that a call.not_answered webhook prematurely marked as
// ended/missed at the customer level while it was actually rolling over to
// another team's queue (a Team Call Data Action arriving for the call proves
// it is still live). Restores active/ringing state and undoes the missed
// count so the eventual call.answered / call.ended settles the stats.
export function statsReviveCall(customerId: string, callId: string) {
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  flags.end = false;
  if (flags.missed) {
    flags.missed = false;
    tenant.dailyStats.missed = Math.max(0, tenant.dailyStats.missed - 1);
  }
  const call = tenant.todayCalls.get(callId);
  tenant.activeCallIds.set(callId, call?.timestamp ?? Date.now());
  if (!flags.answer) {
    tenant.ringingCallIds.add(callId);
    if ((call?.direction ?? "inbound") === "inbound") tenant.queueRingingCallIds.add(callId);
  }
  tenant.dailyStats.active = tenant.activeCallIds.size;
}

// Normalizes a raw webhook sentiment string (case-insensitive) to the
// canonical Positive/Neutral/Negative values, or null if unknown/unsuitable.
export function normalizeSentiment(sentiment: string | null | undefined): "Positive" | "Neutral" | "Negative" | null {
  if (!sentiment) return null;
  const key = sentiment.trim().toLowerCase();
  if (key === "positive") return "Positive";
  if (key === "neutral") return "Neutral";
  if (key === "negative") return "Negative";
  return null;
}

// Counts sentiment into daily stats. Returns true if counted. Unknown/null
// sentiment values are skipped entirely (no bucket incremented). Works even
// when the call has aged out of the live ticker — the countedFlags map guards
// against double counting per call.
export function statsSentiment(customerId: string, callId: string, sentiment: string): boolean {
  const normalized = normalizeSentiment(sentiment);
  if (!normalized) return false;
  const tenant = getTenant(customerId);
  const flags = getFlags(tenant, callId);
  if (flags.sentiment) return false;
  flags.sentiment = true;
  if (normalized === "Positive") tenant.dailyStats.positive++;
  else if (normalized === "Negative") tenant.dailyStats.negative++;
  else tenant.dailyStats.neutral++;
  return true;
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
      // DB columns keep their legacy happy/normal/angry names (renaming the
      // persisted schema was deemed risky); they map to positive/neutral/negative.
      tenant.dailyStats.positive = row.happy;
      tenant.dailyStats.neutral = row.normal;
      tenant.dailyStats.negative = row.angry;
      tenant.dailyStats.totalDuration = row.total_duration;
      tenant.dailyStats.inboundTotalDuration = row.inbound_total_duration || 0;
      tenant.dailyStats.inboundDurationCount = row.inbound_duration_count || 0;
      tenant.dailyStats.outboundTotalDuration = row.outbound_total_duration || 0;
      tenant.dailyStats.outboundDurationCount = row.outbound_duration_count || 0;
      tenant.dailyStats.avgCallDurationInbound = row.avg_call_duration_inbound || (
        tenant.dailyStats.inboundDurationCount > 0
          ? Math.round(tenant.dailyStats.inboundTotalDuration / tenant.dailyStats.inboundDurationCount)
          : 0
      );
      tenant.dailyStats.avgCallDurationOutbound = row.avg_call_duration_outbound || (
        tenant.dailyStats.outboundDurationCount > 0
          ? Math.round(tenant.dailyStats.outboundTotalDuration / tenant.dailyStats.outboundDurationCount)
          : 0
      );
    }

    tenant.todayCalls.clear();
    tenant.countedFlags.clear();
    tenant.activeCallIds.clear();
    tenant.queueRingingCallIds.clear();
    tenant.ringingCallIds.clear();
    tenant.pendingTeamAssignments.clear();

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
      const avgIn = s.inboundDurationCount > 0 ? Math.round(s.inboundTotalDuration / s.inboundDurationCount) : 0;
      const avgOut = s.outboundDurationCount > 0 ? Math.round(s.outboundTotalDuration / s.outboundDurationCount) : 0;
      await pool.query(
        `INSERT INTO team_daily_stats (customer_id, team_id, date, total, inbound, outbound, answered, missed, inbound_answered, outbound_answered, total_duration, total_wait_time, answered_with_wait, inbound_total_duration, inbound_duration_count, outbound_total_duration, outbound_duration_count, avg_call_duration_inbound, avg_call_duration_outbound)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
           answered_with_wait = EXCLUDED.answered_with_wait,
           inbound_total_duration = EXCLUDED.inbound_total_duration,
           inbound_duration_count = EXCLUDED.inbound_duration_count,
           outbound_total_duration = EXCLUDED.outbound_total_duration,
           outbound_duration_count = EXCLUDED.outbound_duration_count,
           avg_call_duration_inbound = EXCLUDED.avg_call_duration_inbound,
           avg_call_duration_outbound = EXCLUDED.avg_call_duration_outbound`,
        [customerId, teamId, today, s.total, s.inbound, s.outbound, s.answered, s.missed, s.inboundAnswered, s.outboundAnswered, s.totalDuration, s.totalWaitTime, s.answeredWithWait, s.inboundTotalDuration, s.inboundDurationCount, s.outboundTotalDuration, s.outboundDurationCount, avgIn, avgOut]
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
      team.stats.inbound = row.inbound;
      team.stats.outbound = row.outbound;
      team.stats.answered = row.answered;
      team.stats.missed = row.missed;
      team.stats.inboundAnswered = row.inbound_answered || 0;
      team.stats.outboundAnswered = row.outbound_answered || 0;
      team.stats.totalDuration = row.total_duration;
      team.stats.totalWaitTime = row.total_wait_time || 0;
      team.stats.answeredWithWait = row.answered_with_wait || 0;
      team.stats.inboundTotalDuration = row.inbound_total_duration || 0;
      team.stats.inboundDurationCount = row.inbound_duration_count || 0;
      team.stats.outboundTotalDuration = row.outbound_total_duration || 0;
      team.stats.outboundDurationCount = row.outbound_duration_count || 0;
      team.stats.avgCallDurationInbound = row.avg_call_duration_inbound || (
        team.stats.inboundDurationCount > 0
          ? Math.round(team.stats.inboundTotalDuration / team.stats.inboundDurationCount)
          : 0
      );
      team.stats.avgCallDurationOutbound = row.avg_call_duration_outbound || (
        team.stats.outboundDurationCount > 0
          ? Math.round(team.stats.outboundTotalDuration / team.stats.outboundDurationCount)
          : 0
      );
      team.activeCallIds.clear();
      team.countedFlags.clear();
      team.callIds.clear();
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
    const avgIn = s.inboundDurationCount > 0 ? Math.round(s.inboundTotalDuration / s.inboundDurationCount) : 0;
    const avgOut = s.outboundDurationCount > 0 ? Math.round(s.outboundTotalDuration / s.outboundDurationCount) : 0;
    await pool.query(
      `INSERT INTO wallboard_stats (customer_id, date, total, active, inbound, outbound, answered, missed, inbound_answered, outbound_answered, happy, normal, angry, total_duration, inbound_total_duration, inbound_duration_count, outbound_total_duration, outbound_duration_count, avg_call_duration_inbound, avg_call_duration_outbound)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
         total_duration = EXCLUDED.total_duration,
         inbound_total_duration = EXCLUDED.inbound_total_duration,
         inbound_duration_count = EXCLUDED.inbound_duration_count,
         outbound_total_duration = EXCLUDED.outbound_total_duration,
         outbound_duration_count = EXCLUDED.outbound_duration_count,
         avg_call_duration_inbound = EXCLUDED.avg_call_duration_inbound,
         avg_call_duration_outbound = EXCLUDED.avg_call_duration_outbound`,
      // DB columns happy/normal/angry intentionally retain legacy names;
      // they store the Positive/Neutral/Negative counts respectively.
      [customerId, today, s.total, s.active, s.inbound, s.outbound, s.answered, s.missed, s.inboundAnswered, s.outboundAnswered, s.positive, s.neutral, s.negative, s.totalDuration, s.inboundTotalDuration, s.inboundDurationCount, s.outboundTotalDuration, s.outboundDurationCount, avgIn, avgOut]
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
  tenant.activeCallIds.clear();
  tenant.queueRingingCallIds.clear();
  tenant.ringingCallIds.clear();
  tenant.pendingTeamAssignments.clear();
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

function withAvgs(s: DailyStats): DailyStats {
  return {
    ...s,
    avgCallDurationInbound: s.inboundDurationCount > 0 ? Math.round(s.inboundTotalDuration / s.inboundDurationCount) : 0,
    avgCallDurationOutbound: s.outboundDurationCount > 0 ? Math.round(s.outboundTotalDuration / s.outboundDurationCount) : 0,
  };
}

function withTeamAvgs(s: TeamStats): TeamStats {
  return {
    ...s,
    avgCallDurationInbound: s.inboundDurationCount > 0 ? Math.round(s.inboundTotalDuration / s.inboundDurationCount) : 0,
    avgCallDurationOutbound: s.outboundDurationCount > 0 ? Math.round(s.outboundTotalDuration / s.outboundDurationCount) : 0,
  };
}

// Live KPI numbers (active / ringing / callsInQueue) are DERIVED from the
// canonical call objects via isLiveCall — the same objects the ticker renders —
// so they can never drift apart. Internal counters (activeCallIds,
// ringingCallIds, dailyStats.active) remain as bookkeeping only.
export function getStats(customerId: string): DailyStats {
  const tenant = getTenant(customerId);
  const live = liveCalls(tenant);
  let ringing = 0;
  let callsInQueue = 0;
  for (const c of live) {
    if (c.status === "active") {
      ringing++;
      if (tenant.queueRingingCallIds.has(c.id)) callsInQueue++;
    }
  }
  return {
    ...withAvgs(tenant.dailyStats),
    active: live.length,
    callsInQueue,
    ringing,
  };
}

export function getGlobalStats(): DailyStats {
  const agg: DailyStats = emptyStats();
  agg.ringing = 0;
  Array.from(tenants.values()).forEach((tenant) => {
    const s = tenant.dailyStats;
    const live = liveCalls(tenant);
    agg.total += s.total;
    agg.active += live.length;
    agg.ringing! += live.filter((c) => c.status === "active").length;
    agg.inbound += s.inbound;
    agg.outbound += s.outbound;
    agg.answered += s.answered;
    agg.missed += s.missed;
    agg.inboundAnswered += s.inboundAnswered;
    agg.outboundAnswered += s.outboundAnswered;
    agg.positive += s.positive;
    agg.neutral += s.neutral;
    agg.negative += s.negative;
    agg.totalDuration += s.totalDuration;
    agg.inboundTotalDuration += s.inboundTotalDuration;
    agg.inboundDurationCount += s.inboundDurationCount;
    agg.outboundTotalDuration += s.outboundTotalDuration;
    agg.outboundDurationCount += s.outboundDurationCount;
  });
  return withAvgs(agg);
}

export function getPerCustomerStats(): Record<string, DailyStats> {
  const result: Record<string, DailyStats> = {};
  Array.from(tenants.keys()).forEach((customerId) => {
    result[customerId] = getStats(customerId);
  });
  return result;
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

export function teamStatsNewCall(customerId: string, teamId: string, callId: string, direction: "inbound" | "outbound", startedAt?: number) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  const existingFlags = team.countedFlags.get(callId);
  if (existingFlags?.end) {
    return;
  }
  getTeamFlags(team, callId);
  team.callIds.add(callId);
  team.activeCallIds.set(callId, startedAt ?? Date.now());
  team.stats.total++;
  if (direction === "inbound") team.stats.inbound++;
  else team.stats.outbound++;
  team.stats.active = team.activeCallIds.size;
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
}

// Shared wait-recording core: counts a wait sample once per call per team.
// If a wait was already counted for this call (e.g. from an earlier event),
// the later value replaces it rather than double-counting.
function recordTeamWaitOnFlags(team: InternalTeamState, callId: string, waitSeconds: number) {
  if (!waitSeconds || waitSeconds <= 0) return;
  const flags = getTeamFlags(team, callId);
  const rounded = Math.round(waitSeconds);
  if (rounded <= 0) return;
  if (flags.waitCounted) {
    team.stats.totalWaitTime += rounded - flags.waitSeconds;
    if (team.stats.totalWaitTime < 0) team.stats.totalWaitTime = 0;
    flags.waitSeconds = rounded;
    return;
  }
  flags.waitCounted = true;
  flags.waitSeconds = rounded;
  team.stats.totalWaitTime += rounded;
  team.stats.answeredWithWait++;
}

// Records the caller wait time taken from the webhook payload's `waitTime`
// attribute (present on both call.answered and call.ended).
export function teamStatsRecordWait(customerId: string, teamId: string, callId: string, waitSeconds: number) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  recordTeamWaitOnFlags(team, callId, waitSeconds);
}

// Returns the timestamp (ms) when the call started ringing for THIS team, or
// null if no live wait timer exists. Used to compute a team-local wait for
// rolled-over calls, where the payload's waitTime (measured from the initial
// ring) would overstate the wait for teams the call reached later.
export function getTeamRingStart(customerId: string, teamId: string, callId: string): number | null {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  return team?.waitingCalls.get(callId) ?? null;
}

// --- Team Call Data Action support -----------------------------------------
// Spoke's Team Call Data Action fires just before a call is offered to a team,
// letting us attribute a queue-bound ringing call to its exact team.

function cleanupPendingAssignments(tenant: TenantState, now: number = Date.now()) {
  for (const [callId, pending] of tenant.pendingTeamAssignments) {
    if (pending.expiresAt <= now) tenant.pendingTeamAssignments.delete(callId);
  }
}

// Holds a team assignment for a call we have not seen yet (data action arrived
// before call.started). Applied when the call shows up; expires after TTL.
export function setPendingTeamAssignment(customerId: string, callId: string, teamId: string, teamName?: string) {
  const tenant = getTenant(customerId);
  cleanupPendingAssignments(tenant);
  tenant.pendingTeamAssignments.set(callId, {
    teamId,
    teamName,
    expiresAt: Date.now() + PENDING_TEAM_ASSIGNMENT_TTL_MS,
  });
}

// Returns and removes the pending team assignment for a call, or null if none
// exists (or it expired).
export function takePendingTeamAssignment(customerId: string, callId: string): { teamId: string; teamName?: string } | null {
  const tenant = getTenant(customerId);
  const pending = tenant.pendingTeamAssignments.get(callId);
  if (!pending) return null;
  tenant.pendingTeamAssignments.delete(callId);
  if (pending.expiresAt <= Date.now()) return null;
  return { teamId: pending.teamId, teamName: pending.teamName };
}

// Attributes a live ringing call to a team: counts it as a new team call and
// starts a fresh wait timer. Clears any stale per-team flags for this call so
// re-attribution after an earlier rollover away (A → B → A) works.
export function teamAttributeRingingCall(customerId: string, teamId: string, callId: string, direction: "inbound" | "outbound", startedAt?: number) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  team.countedFlags.delete(callId);
  getTeamFlags(team, callId);
  team.callIds.add(callId);
  team.activeCallIds.set(callId, startedAt ?? Date.now());
  team.stats.total++;
  if (direction === "inbound") team.stats.inbound++;
  else team.stats.outbound++;
  team.stats.active = team.activeCallIds.size;
  team.waitingCalls.set(callId, Date.now());
}

// Ensures a call already counted for a team also has a live wait timer
// (e.g. the data action confirmed a team the call.started webhook already
// carried). Never double-counts; only starts the timer if absent.
export function markTeamCallWaiting(customerId: string, teamId: string, callId: string) {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return;
  if (!team.activeCallIds.has(callId)) return;
  const flags = team.countedFlags.get(callId);
  if (flags?.answer || flags?.end) return;
  if (!team.waitingCalls.has(callId)) team.waitingCalls.set(callId, Date.now());
}

// Credits a missed call to the team a rolling-over call is leaving: the team
// did not answer, so its missed count goes up and the call leaves its queue.
// The customer-level stats are untouched — it is still one physical call.
export function teamRolloverMiss(customerId: string, teamId: string, callId: string, now: number = Date.now()) {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return;
  const flags = getTeamFlags(team, callId);
  // The time the call rang in this team's queue counts toward the team's
  // average wait time — not answering does not absolve the team of the wait.
  const ringStart = team.waitingCalls.get(callId);
  if (ringStart && !flags.answer) {
    recordTeamWaitOnFlags(team, callId, (now - ringStart) / 1000);
  }
  team.activeCallIds.delete(callId);
  team.waitingCalls.delete(callId);
  team.stats.active = team.activeCallIds.size;
  if (!flags.answer && !flags.missed) {
    flags.missed = true;
    team.stats.missed++;
  }
  flags.end = true;
}

export function teamStatsEndCall(customerId: string, teamId: string, callId: string, finalStatus: string, duration: number | null, now: number = Date.now()) {
  const tenant = getTenant(customerId);
  const team = getTeam(tenant, teamId);
  const flags = getTeamFlags(team, callId);
  // A call that ends missed still waited in this team's queue — credit the
  // ring time to the team's average wait (covers queue timeouts/rollovers
  // reported via call.not_answered as well as abandoned calls).
  if (finalStatus === "missed" && !flags.answer) {
    const ringStart = team.waitingCalls.get(callId);
    if (ringStart) recordTeamWaitOnFlags(team, callId, (now - ringStart) / 1000);
  }
  team.activeCallIds.delete(callId);
  team.waitingCalls.delete(callId);
  team.stats.active = team.activeCallIds.size;
  flags.end = true;
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
  if (duration && duration > 0 && !flags.durationCounted && (finalStatus === "answered" || flags.answer)) {
    flags.durationCounted = true;
    team.stats.totalDuration += duration;
    const dir = tenant.todayCalls.get(callId)?.direction;
    if (dir === "inbound") {
      team.stats.inboundTotalDuration += duration;
      team.stats.inboundDurationCount++;
    } else if (dir === "outbound") {
      team.stats.outboundTotalDuration += duration;
      team.stats.outboundDurationCount++;
    }
  }
  evictOldFlagsTeam(team);
}

export interface StaleSweepResult {
  customerId: string;
  removedTenantCallIds: string[];
  affectedTeamIds: Set<string>;
  // Call objects the sweep force-ended (their status was mutated in place),
  // so routes can broadcast the healing patches to connected tickers.
  endedCalls: CallData[];
}

export function sweepStaleCalls(staleMs: number = STALE_CALL_MS, now: number = Date.now()): StaleSweepResult[] {
  const results: StaleSweepResult[] = [];
  for (const [customerId, tenant] of tenants) {
    cleanupPendingAssignments(tenant, now);
    const removedTenantCallIds: string[] = [];
    for (const [callId, startedAt] of tenant.activeCallIds) {
      if (now - startedAt > staleMs) {
        tenant.activeCallIds.delete(callId);
        tenant.queueRingingCallIds.delete(callId);
        tenant.ringingCallIds.delete(callId);
        const flags = tenant.countedFlags.get(callId);
        if (flags) flags.end = true;
        removedTenantCallIds.push(callId);
      }
    }
    const affectedTeamIds = new Set<string>();
    for (const [teamId, team] of tenant.teams) {
      let teamHadRemoval = false;
      for (const [callId, startedAt] of team.activeCallIds) {
        if (now - startedAt > staleMs) {
          team.activeCallIds.delete(callId);
          team.waitingCalls.delete(callId);
          const flags = team.countedFlags.get(callId);
          if (flags) flags.end = true;
          teamHadRemoval = true;
        }
      }
      if (teamHadRemoval) {
        team.stats.active = team.activeCallIds.size;
        affectedTeamIds.add(teamId);
      }
    }
    if (removedTenantCallIds.length > 0) {
      tenant.dailyStats.active = tenant.activeCallIds.size;
    }

    // Force-end the stale CALL OBJECTS themselves — the KPIs are derived from
    // them, and the ticker renders them, so healing only the counters (the old
    // behaviour) left "Talking forever" ghost rows. A stale ringing call
    // becomes missed; a stale connected call becomes ended ("timed out").
    const endedCalls: CallData[] = [];
    for (const call of tenant.todayCalls.values()) {
      if (!isLiveCall(call)) continue;
      const startedAt = tenant.activeCallIds.get(call.id) ?? call.timestamp;
      if (now - startedAt <= staleMs) continue;
      if (call.status === "active") {
        call.status = "missed";
      } else {
        call.status = "ended";
      }
      call.durationText = call.durationText ?? "timed out";
      const flags = tenant.countedFlags.get(call.id);
      if (flags) flags.end = true;
      tenant.activeCallIds.delete(call.id);
      tenant.queueRingingCallIds.delete(call.id);
      tenant.ringingCallIds.delete(call.id);
      if (call.teamId) affectedTeamIds.add(call.teamId);
      endedCalls.push(call);
    }

    if (removedTenantCallIds.length > 0 || affectedTeamIds.size > 0 || endedCalls.length > 0) {
      results.push({ customerId, removedTenantCallIds, affectedTeamIds, endedCalls });
    }
  }
  return results;
}

export interface DriftDebug {
  lateNewCallSkipsSinceBoot: number;
  perTenant: Array<{
    customerId: string;
    activeSize: number;
    flagsSize: number;
    todayCallsSize: number;
    perTeam: Array<{
      teamId: string;
      activeSize: number;
      flagsSize: number;
    }>;
  }>;
}

export function getDriftDebug(): DriftDebug {
  const perTenant: DriftDebug["perTenant"] = [];
  for (const [customerId, tenant] of tenants) {
    const perTeam: DriftDebug["perTenant"][number]["perTeam"] = [];
    for (const [teamId, team] of tenant.teams) {
      perTeam.push({
        teamId,
        activeSize: team.activeCallIds.size,
        flagsSize: team.countedFlags.size,
      });
    }
    perTenant.push({
      customerId,
      activeSize: tenant.activeCallIds.size,
      flagsSize: tenant.countedFlags.size,
      todayCallsSize: tenant.todayCalls.size,
      perTeam,
    });
  }
  return { lateNewCallSkipsSinceBoot, perTenant };
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

// Reconciles a roster snapshot against the canonical live calls: an agent
// reported "available" while named on a live CONNECTED call is presented as
// busy ("On a call" / "On another call" when the call belongs to a different
// team). Never mutates the stored agents — a later availability webhook stays
// authoritative for the stored state.
export function reconcileTeamAgents(customerId: string, teamId: string, agents: TeamAgent[]): TeamAgent[] {
  const tenant = getTenant(customerId);
  const liveByAgent = new Map<string, CallData>();
  for (const c of tenant.todayCalls.values()) {
    if (c.agentId && c.status === "answered" && c.duration == null) {
      liveByAgent.set(c.agentId, c);
    }
  }
  if (liveByAgent.size === 0) return agents;
  return agents.map((a) => {
    if (a.availability.status !== "available") return a;
    const call = liveByAgent.get(a.id);
    if (!call) return a;
    const onOtherTeam = !!call.teamId && call.teamId !== teamId;
    return {
      ...a,
      availability: {
        ...a.availability,
        status: "busy" as const,
        notAvailableReason: onOtherTeam ? "On another call" : "On a call",
        callId: call.id,
      },
    };
  });
}

export function getTeamState(customerId: string, teamId: string): TeamState | null {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return null;
  return {
    summary: { ...team.summary },
    agents: reconcileTeamAgents(customerId, teamId, team.agents),
    stats: withLiveCounts(customerId, teamId, team),
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
    if (!call) continue;
    // Per-team VIEW of a shared call object: once a call rolls over to a
    // different team, this team's history shows it as missed (it left this
    // queue unanswered) — never as a live row that resurrects on refresh.
    if (call.teamId && call.teamId !== teamId) {
      calls.push({
        ...call,
        status: "missed",
        duration: null,
        durationText: null,
        agentId: undefined,
        agentName: undefined,
      });
    } else {
      calls.push(call);
    }
  }
  return calls.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

// Derives active/ringing/talking from the canonical live call slice for this
// team (same objects the ticker renders, same isLiveCall predicate) so KPIs
// and ticker can never disagree. Ringing = live calls not yet answered;
// talking = live answered calls. Availability webhooks (waitingCalls) no
// longer drive these counts — the call objects themselves are the evidence.
function withLiveCounts(customerId: string, teamId: string, team: InternalTeamState): TeamStats {
  const tenant = getTenant(customerId);
  const slice = teamLiveSlice(tenant, teamId);
  let ringing = 0;
  for (const c of slice) {
    if (c.status === "active") ringing++;
  }
  return {
    ...withTeamAvgs(team.stats),
    active: slice.length,
    liveWaitAvg: getTeamLiveWaitAvg(customerId, teamId),
    ringing,
    talking: slice.length - ringing,
  };
}

export function getAllTeamStats(customerId: string): Record<string, TeamStats> {
  const tenant = getTenant(customerId);
  const result: Record<string, TeamStats> = {};
  for (const [teamId, team] of tenant.teams) {
    result[teamId] = withLiveCounts(customerId, teamId, team);
  }
  return result;
}

export function getTeamStats(customerId: string, teamId: string): TeamStats {
  const tenant = getTenant(customerId);
  const team = tenant.teams.get(teamId);
  if (!team) return emptyTeamStats();
  return withLiveCounts(customerId, teamId, team);
}
