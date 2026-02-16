import type { CallData, DailyStats } from "@shared/schema";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const MAX_RECENT_CALLS = 200;

export let todayCalls = new Map<string, CallData>();

const countedFlags = new Map<string, { answer: boolean; missed: boolean; end: boolean; sentiment: boolean }>();

function getFlags(callId: string) {
  if (!countedFlags.has(callId)) {
    countedFlags.set(callId, { answer: false, missed: false, end: false, sentiment: false });
  }
  return countedFlags.get(callId)!;
}

export let dailyStats: DailyStats = {
  total: 0,
  active: 0,
  inbound: 0,
  outbound: 0,
  answered: 0,
  missed: 0,
  happy: 0,
  normal: 0,
  angry: 0,
  totalDuration: 0,
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function trimOldCalls() {
  if (todayCalls.size <= MAX_RECENT_CALLS) return;
  const sorted = Array.from(todayCalls.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp);
  const toKeep = new Set<string>();
  for (const [id, call] of sorted) {
    if (call.status === "active" || toKeep.size < MAX_RECENT_CALLS) {
      toKeep.add(id);
    }
  }
  for (const [id] of sorted) {
    if (!toKeep.has(id)) {
      todayCalls.delete(id);
      countedFlags.delete(id);
    }
  }
}

export function statsNewCall(callId: string, direction: "inbound" | "outbound") {
  getFlags(callId);
  dailyStats.total++;
  dailyStats.active++;
  if (direction === "inbound") dailyStats.inbound++;
  else dailyStats.outbound++;
}

export function statsAnswer(callId: string) {
  const flags = getFlags(callId);
  if (flags.answer) return;
  flags.answer = true;
  dailyStats.answered++;
  if (flags.missed) {
    dailyStats.missed--;
    flags.missed = false;
  }
}

export function statsEndCall(callId: string, finalStatus: string, duration: number | null) {
  const flags = getFlags(callId);
  if (!flags.end) {
    flags.end = true;
    dailyStats.active = Math.max(0, dailyStats.active - 1);
  }
  if (finalStatus === "missed" && !flags.missed && !flags.answer) {
    flags.missed = true;
    dailyStats.missed++;
  }
  if (finalStatus === "answered" && !flags.answer) {
    flags.answer = true;
    dailyStats.answered++;
  }
  if (duration && duration > 0) {
    dailyStats.totalDuration += duration;
  }
}

export function statsSentiment(callId: string, sentiment: string) {
  const flags = getFlags(callId);
  if (flags.sentiment) return;
  flags.sentiment = true;
  const key = sentiment.toLowerCase();
  if (key === "happy") dailyStats.happy++;
  else if (key === "angry") dailyStats.angry++;
  else dailyStats.normal++;
}

export async function loadFromDb() {
  try {
    const today = todayDate();

    const statsResult = await pool.query(
      "SELECT * FROM wallboard_stats WHERE date = $1",
      [today]
    );

    if (statsResult.rows.length > 0) {
      const row = statsResult.rows[0];
      dailyStats.total = row.total;
      dailyStats.active = 0;
      dailyStats.inbound = row.inbound;
      dailyStats.outbound = row.outbound;
      dailyStats.answered = row.answered;
      dailyStats.missed = row.missed;
      dailyStats.happy = row.happy;
      dailyStats.normal = row.normal;
      dailyStats.angry = row.angry;
      dailyStats.totalDuration = row.total_duration;
    }

    todayCalls.clear();
    countedFlags.clear();

    await pool.query("UPDATE wallboard_stats SET active = 0 WHERE date = $1", [today]);

    console.log(
      `[db] Loaded stats for ${today} (total: ${dailyStats.total})`
    );
  } catch (err) {
    console.error("[db] Failed to load from database:", err);
  }
}

export async function persistStats() {
  try {
    const today = todayDate();
    await pool.query(
      `INSERT INTO wallboard_stats (date, total, active, inbound, outbound, answered, missed, happy, normal, angry, total_duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (date) DO UPDATE SET
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
      [
        today,
        dailyStats.total,
        dailyStats.active,
        dailyStats.inbound,
        dailyStats.outbound,
        dailyStats.answered,
        dailyStats.missed,
        dailyStats.happy,
        dailyStats.normal,
        dailyStats.angry,
        dailyStats.totalDuration,
      ]
    );
  } catch (err) {
    console.error("[db] Failed to persist stats:", err);
  }
}

export async function resetState() {
  todayCalls.clear();
  countedFlags.clear();
  dailyStats = {
    total: 0,
    active: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    happy: 0,
    normal: 0,
    angry: 0,
    totalDuration: 0,
  };

  try {
    const today = todayDate();
    await pool.query("DELETE FROM wallboard_stats WHERE date < $1", [today]);
  } catch (err) {
    console.error("[db] Failed to clean old data:", err);
  }
}

export function addCall(call: CallData) {
  todayCalls.set(call.id, call);
  trimOldCalls();
}

export function getStats(): DailyStats {
  return { ...dailyStats };
}

export function getRecentCalls(limit = 30): CallData[] {
  return Array.from(todayCalls.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
