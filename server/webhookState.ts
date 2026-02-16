import type { CallData, DailyStats } from "@shared/schema";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export let todayCalls = new Map<string, CallData>();

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

function callToRow(call: CallData) {
  return [
    call.id,
    call.direction,
    call.status,
    call.sentiment,
    call.from.lat,
    call.from.lng,
    call.from.name,
    call.to.lat,
    call.to.lng,
    call.to.name,
    call.fromLabel,
    call.toLabel,
    call.startedAt,
    call.timestamp,
    call.duration,
    call.durationText,
    call.answeredAt || null,
    todayDate(),
  ];
}

function rowToCall(row: any): CallData {
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    sentiment: row.sentiment,
    from: { lat: row.from_lat, lng: row.from_lng, name: row.from_name },
    to: { lat: row.to_lat, lng: row.to_lng, name: row.to_name },
    fromLabel: row.from_label,
    toLabel: row.to_label,
    startedAt: row.started_at,
    timestamp: Number(row.timestamp),
    duration: row.duration,
    durationText: row.duration_text,
    answeredAt: row.answered_at || undefined,
  };
}

export function recomputeStats() {
  const calls = Array.from(todayCalls.values());
  dailyStats.total = calls.length;
  dailyStats.active = calls.filter((c) => c.status === "active").length;
  dailyStats.inbound = calls.filter((c) => c.direction === "inbound").length;
  dailyStats.outbound = calls.filter((c) => c.direction === "outbound").length;
  dailyStats.answered = calls.filter((c) => c.status === "answered").length;
  dailyStats.missed = calls.filter((c) => c.status === "missed").length;
  dailyStats.happy = calls.filter((c) => c.sentiment === "Happy").length;
  dailyStats.normal = calls.filter((c) => c.sentiment === "Normal").length;
  dailyStats.angry = calls.filter((c) => c.sentiment === "Angry").length;
  dailyStats.totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
}

export async function loadFromDb() {
  try {
    const today = todayDate();

    const callsResult = await pool.query(
      "SELECT * FROM wallboard_calls WHERE created_date = $1 ORDER BY timestamp DESC",
      [today]
    );

    todayCalls.clear();
    for (const row of callsResult.rows) {
      const call = rowToCall(row);
      if (call.status === "active") {
        call.status = "missed";
      }
      todayCalls.set(call.id, call);
    }

    recomputeStats();

    await pool.query("UPDATE wallboard_calls SET status = 'missed' WHERE created_date = $1 AND status = 'active'", [today]);
    await persistStats();

    console.log(
      `[db] Loaded ${todayCalls.size} calls and stats for ${today}`
    );
  } catch (err) {
    console.error("[db] Failed to load from database:", err);
  }
}

export async function persistCall(call: CallData) {
  try {
    const values = callToRow(call);
    await pool.query(
      `INSERT INTO wallboard_calls (id, direction, status, sentiment, from_lat, from_lng, from_name, to_lat, to_lng, to_name, from_label, to_label, started_at, timestamp, duration, duration_text, answered_at, created_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         sentiment = EXCLUDED.sentiment,
         duration = EXCLUDED.duration,
         duration_text = EXCLUDED.duration_text,
         answered_at = EXCLUDED.answered_at`,
      values
    );
  } catch (err) {
    console.error("[db] Failed to persist call:", err);
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
    await pool.query("DELETE FROM wallboard_calls WHERE created_date < $1", [today]);
    await pool.query("DELETE FROM wallboard_stats WHERE date < $1", [today]);
  } catch (err) {
    console.error("[db] Failed to clean old data:", err);
  }
}

export function getStats(): DailyStats {
  return { ...dailyStats };
}

export function getRecentCalls(limit = 30): CallData[] {
  return Array.from(todayCalls.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
