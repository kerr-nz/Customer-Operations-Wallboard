// Regression harness for the team wallboard KPI/ticker/roster drift findings
// (DIAGNOSIS-team-wallboard-drift.md). These tests REPLAY the suspect
// webhook/event sequences against the real in-memory state functions and
// assert the CORRECTED behaviour: KPIs are derived from the same canonical
// call objects the ticker renders (isLiveCall), the sweep force-ends stale
// call objects, rollovers rewrite the losing team's view, and rosters are
// reconciled against live calls.

import test from "node:test";
import assert from "node:assert/strict";

import {
  addCall,
  getCall,
  getTodayCalls,
  getRecentCalls,
  getTeamRecentCalls,
  getStats,
  getTeamStats,
  statsNewCall,
  statsAnswer,
  statsEndCall,
  teamStatsNewCall,
  teamStatsAnswer,
  teamStatsEndCall,
  teamAttributeRingingCall,
  teamRolloverMiss,
  updateTeamAvailability,
  updateUserAvailabilityAcrossTeams,
  getTeamState,
  sweepStaleCalls,
  STALE_CALL_MS,
} from "./webhookState";
import type { CallData, TeamAgent, TeamSummary } from "@shared/schema";

let uid = 0;
function ids() {
  uid += 1;
  return { customerId: `diag-${uid}-${Date.now()}`, teamId: `team-${uid}` };
}

function mkCall(id: string, overrides: Partial<CallData> = {}): CallData {
  return {
    id,
    direction: "inbound",
    status: "active",
    sentiment: null,
    from: { lat: 0, lng: 0, name: "A" },
    to: { lat: 1, lng: 1, name: "B" },
    fromLabel: "A",
    toLabel: "B",
    startedAt: new Date().toISOString(),
    timestamp: Date.now(),
    duration: null,
    durationText: null,
    ...overrides,
  } as CallData;
}

function summary(teamId: string, o: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: teamId, displayName: teamId, totalMembers: 1, totalAvailable: 1,
    status: "available", availabilitySummary: "1 of 1 available", ...o,
  };
}

function agent(agentId: string, status: TeamAgent["availability"]["status"], callId?: string): TeamAgent {
  return {
    id: agentId, displayName: agentId, firstName: agentId, lastName: "",
    email: `${agentId}@x.com`, loginStatus: "loggedIn",
    availability: {
      status, statusAt: new Date().toISOString(), statusTimestamp: Date.now(),
      availabilitySummary: status, callId,
    },
  };
}

// Mirrors the ticker's "live" predicate in TeamWallboard.tsx (ActiveCallsQueue
// and the per-call "Talking" label): active, or answered with no duration.
function tickerLive(calls: CallData[]): CallData[] {
  return calls.filter(c => c.status === "active" || (c.status === "answered" && c.duration === null));
}
function tickerTalking(calls: CallData[]): CallData[] {
  return calls.filter(c => c.status === "answered" && c.duration == null);
}

// ---------------------------------------------------------------------------
// FINDING 1 (fixed) — Dropped call.ended: the sweep now force-ends the call
// OBJECT too, so KPI and ticker heal together.
// ---------------------------------------------------------------------------
test("F1 fixed: dropped call.ended — sweep heals KPI AND ticker together", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();
  const startedAt = now - STALE_CALL_MS - 60_000;

  // call.started + call.answered arrived; call.ended was DROPPED.
  const call = mkCall("c-dropped-end", { status: "answered", timestamp: startedAt, teamId });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", startedAt);
  teamStatsNewCall(customerId, teamId, call.id, "inbound", startedAt);
  statsAnswer(customerId, call.id, "inbound");
  teamStatsAnswer(customerId, teamId, call.id, "inbound");

  // Before the sweep: KPI and ticker agree (both say 1 talking).
  assert.equal(getTeamStats(customerId, teamId).talking, 1);
  assert.equal(tickerTalking(getTeamRecentCalls(customerId, teamId)).length, 1);

  // 90-minute stale sweep runs.
  sweepStaleCalls(STALE_CALL_MS, now);

  // KPI healed…
  const s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 0, "KPI active healed by sweep");
  assert.equal(s.talking, 0, "KPI talking healed by sweep");

  // …and so is the ticker: the call object itself was force-ended.
  const ticker = getTeamRecentCalls(customerId, teamId);
  assert.equal(tickerTalking(ticker).length, 0, "ticker no longer shows the call as Talking");
  assert.equal(getCall(customerId, call.id)!.status, "ended", "call object marked ended by the sweep");
});

// ---------------------------------------------------------------------------
// FINDING 2 (fixed) — No divergence window: after the sweep catches the older
// orphans, KPI and ticker both say 4 talking (was 4 KPI vs 6 ticker).
// ---------------------------------------------------------------------------
test("F2 fixed: after sweep catches 2 older orphans, KPI and ticker both say 4 talking", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();

  // 2 old orphaned calls (ended webhook dropped >90 min ago) + 4 genuinely
  // live answered calls.
  for (let i = 0; i < 2; i++) {
    const id = `old-${i}`;
    const t = now - STALE_CALL_MS - 120_000;
    addCall(customerId, mkCall(id, { status: "answered", timestamp: t, teamId }));
    statsNewCall(customerId, id, "inbound", t);
    teamStatsNewCall(customerId, teamId, id, "inbound", t);
    statsAnswer(customerId, id, "inbound");
    teamStatsAnswer(customerId, teamId, id, "inbound");
  }
  for (let i = 0; i < 4; i++) {
    const id = `live-${i}`;
    addCall(customerId, mkCall(id, { status: "answered", timestamp: now, teamId }));
    statsNewCall(customerId, id, "inbound", now);
    teamStatsNewCall(customerId, teamId, id, "inbound", now);
    statsAnswer(customerId, id, "inbound");
    teamStatsAnswer(customerId, teamId, id, "inbound");
  }

  sweepStaleCalls(STALE_CALL_MS, now);

  const s = getTeamStats(customerId, teamId);
  const ticker = getTeamRecentCalls(customerId, teamId);
  assert.equal(s.talking, 4, "KPI says 4 talking");
  assert.equal(tickerTalking(ticker).length, 4, "ticker also shows 4 'Talking' calls");
});

// ---------------------------------------------------------------------------
// FINDING 3 (fixed) — Rollover: the losing team's snapshot presents the call
// as missed (its per-team view), never as a live row that resurrects on
// refresh.
// ---------------------------------------------------------------------------
test("F3 fixed: rollover — losing team's ticker shows the call as missed on refresh", () => {
  const { customerId } = ids();
  const teamA = "team-A", teamB = "team-B";
  const call = mkCall("c-rollover", { teamId: teamA, teamName: teamA });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", call.timestamp);
  teamAttributeRingingCall(customerId, teamA, call.id, "inbound", call.timestamp);

  // Data-action rollover A → B (mirrors applyTeamCallDataAction).
  teamRolloverMiss(customerId, teamA, call.id);
  call.teamId = teamB;
  call.teamName = teamB;
  teamAttributeRingingCall(customerId, teamB, call.id, "inbound", call.timestamp);

  // Team A: KPI 0 active, and the snapshot lists the call as MISSED.
  assert.equal(getTeamStats(customerId, teamA).active, 0, "team A shows no live call");
  const tickerA = getTeamRecentCalls(customerId, teamA);
  assert.equal(tickerA.length, 1, "call still in team A history");
  assert.equal(tickerA[0].status, "missed", "presented as missed for team A");
  assert.equal(tickerLive(tickerA).length, 0, "not rendered as live for team A");

  // Team B: the call is live and ringing.
  const sB = getTeamStats(customerId, teamB);
  assert.equal(sB.active, 1, "live for team B");
  assert.equal(sB.ringing, 1, "ringing for team B");
  assert.equal(tickerLive(getTeamRecentCalls(customerId, teamB)).length, 1, "live row for team B");
});

// ---------------------------------------------------------------------------
// FINDING 4 (fixed) — Roster reconciliation: an agent reported "available"
// while named on a live connected call is presented as busy.
// ---------------------------------------------------------------------------
test("F4 fixed: agent named on a live call is presented busy even if availability says available", () => {
  const { customerId, teamId } = ids();

  updateTeamAvailability(customerId, teamId, summary(teamId), [agent("agent-1", "available")]);

  // Live answered call handled by agent-1 (call.answered carried assignedUser).
  const call = mkCall("c-avail", { status: "answered", teamId, agentId: "agent-1", agentName: "agent-1" });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", call.timestamp);
  teamStatsNewCall(customerId, teamId, call.id, "inbound", call.timestamp);
  statsAnswer(customerId, call.id, "inbound");
  teamStatsAnswer(customerId, teamId, call.id, "inbound");

  // A late/out-of-order 'available' update lands. The served roster is
  // reconciled against the live calls, so the agent presents as busy.
  updateUserAvailabilityAcrossTeams(customerId, "agent-1", agent("agent-1", "available"));
  assert.equal(getTeamStats(customerId, teamId).talking, 1, "team has a live talking call");

  const teamState = getTeamState(customerId, teamId);
  assert.equal(teamState!.agents[0].availability.status, "busy", "roster presents the agent as busy");
  assert.equal(teamState!.agents[0].availability.notAvailableReason, "On a call");
  assert.equal(teamState!.agents[0].availability.callId, call.id, "linked to the live call");
});

// ---------------------------------------------------------------------------
// FINDING 5 (fixed) — Ticker cap protects ALL live calls (ringing AND
// connected), so a live answered call can never be evicted while the KPI
// still counts it.
// ---------------------------------------------------------------------------
test("F5 fixed: >100-call flood does not evict a live answered call", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();

  // One live answered call with the OLDEST timestamp…
  const live = mkCall("c-live-answered", { status: "answered", timestamp: now - 10_000, teamId });
  addCall(customerId, live);
  statsNewCall(customerId, live.id, "inbound", live.timestamp);
  teamStatsNewCall(customerId, teamId, live.id, "inbound", live.timestamp);
  statsAnswer(customerId, live.id, "inbound");
  teamStatsAnswer(customerId, teamId, live.id, "inbound");

  // …then 100 newer completed calls flood the buffer.
  for (let i = 0; i < 100; i++) {
    const id = `flood-${i}`;
    addCall(customerId, mkCall(id, { status: "answered", duration: 30, timestamp: now + i }));
  }

  assert.equal(getTeamStats(customerId, teamId).talking, 1, "KPI still counts the live call");
  assert.ok(getCall(customerId, live.id), "the live answered call survives the flood");
  assert.equal(getTeamRecentCalls(customerId, teamId).length, 1, "team ticker still lists it");
  assert.equal(getStats(customerId).active, 1, "tenant KPI agrees");
});

// ---------------------------------------------------------------------------
// FINDING 6 (fixed) — Ringing/talking derive from the call object status, so
// a dropped ringing-availability webhook cannot misclassify a ringing call as
// Talking.
// ---------------------------------------------------------------------------
test("F6 fixed: un-answered team call counts as Ringing even with no availability evidence", () => {
  const { customerId, teamId } = ids();
  // call.started attributed to the team via assignedCallGroup. No availability
  // update ever marks an agent ringing on it.
  const call = mkCall("c-ringing", { status: "active", teamId });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", call.timestamp);
  teamStatsNewCall(customerId, teamId, call.id, "inbound", call.timestamp);

  const s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "KPI counts the un-answered call as Ringing");
  assert.equal(s.talking, 0, "not counted as Talking");
  const ticker = getTeamRecentCalls(customerId, teamId);
  assert.equal(ticker[0].status, "active", "ticker renders the same call as Ringing");
});

// ---------------------------------------------------------------------------
// FINDING 7 (scope check, unchanged) — Teams Board ringing aggregation: only
// teams whose ids are passed in are aggregated (disabled teams excluded), and
// DID calls never enter team stats.
// ---------------------------------------------------------------------------
test("F7: Teams Board scope — disabled teams and DID calls excluded from aggregated ringing", async () => {
  const { customerId } = ids();
  const enabled = "team-on", disabled = "team-off";

  // Ringing team call for each team (data-action path starts the wait timer).
  for (const t of [enabled, disabled]) {
    const id = `ring-${t}`;
    addCall(customerId, mkCall(id, { teamId: t }));
    statsNewCall(customerId, id, "inbound");
    teamAttributeRingingCall(customerId, t, id, "inbound");
  }
  // A DID (person-bound) ringing call: tenant-level only, no team attribution.
  addCall(customerId, mkCall("ring-did"));
  statsNewCall(customerId, "ring-did", "inbound");

  const { aggregateTeamStats } = await import("../client/src/lib/teamStats");
  const statsMap = {
    [enabled]: getTeamStats(customerId, enabled),
    [disabled]: getTeamStats(customerId, disabled),
  };
  // TeamBoard.tsx aggregates over enabledTeams only:
  const agg = aggregateTeamStats([enabled], statsMap);
  assert.equal(agg.ringing, 1, "aggregated ringing counts the enabled team only");
  // DID call is live at the tenant level but in no team's stats.
  assert.equal(getStats(customerId).active, 3);
  assert.equal(statsMap[enabled].active + statsMap[disabled].active, 2, "DID call absent from all team stats");
});

// ---------------------------------------------------------------------------
// FINDING 8 (fixed) — Company/global level: the sweep heals the customer KPI
// and the customer ticker together. Company stats include both directions.
// ---------------------------------------------------------------------------
test("F8 fixed: company-level KPI and ticker heal together on sweep; both directions counted", () => {
  const { customerId } = ids();
  const now = Date.now();
  const t = now - STALE_CALL_MS - 60_000;

  const inb = mkCall("c-in", { status: "answered", timestamp: t, direction: "inbound" });
  const outb = mkCall("c-out", { status: "answered", timestamp: t, direction: "outbound" });
  for (const c of [inb, outb]) {
    addCall(customerId, c);
    statsNewCall(customerId, c.id, c.direction, t);
    statsAnswer(customerId, c.id, c.direction);
  }

  let s = getStats(customerId);
  assert.equal(s.inbound, 1);
  assert.equal(s.outbound, 1, "both directions counted at the customer level");
  assert.equal(s.active, 2);

  sweepStaleCalls(STALE_CALL_MS, now);
  s = getStats(customerId);
  assert.equal(s.active, 0, "customer KPI healed");
  const live = tickerLive(getRecentCalls(customerId));
  assert.equal(live.length, 0, "customer ticker healed too — no ghost live calls");
  assert.equal(getCall(customerId, "c-in")!.status, "ended", "stale connected call marked ended");
  assert.equal(getCall(customerId, "c-out")!.status, "ended");
});
