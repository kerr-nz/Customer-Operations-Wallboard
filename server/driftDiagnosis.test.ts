// Diagnostic harness for Task: team wallboard KPI/ticker/roster drift.
// These tests REPLAY the suspect webhook/event sequences against the real
// in-memory state functions and assert the divergences described in
// DIAGNOSIS-team-wallboard-drift.md. They intentionally assert the CURRENT
// (buggy) behaviour so each finding is reproducible; a follow-up fix task
// should flip the relevant assertions.

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
// FINDING 1 — Dropped call.ended: KPI self-heals at the 90-min sweep, the
// ticker call object is never touched → ticker "Talking" > KPI forever.
// ---------------------------------------------------------------------------
test("F1: dropped call.ended — sweep fixes KPI but leaves ticker call 'Talking' indefinitely", () => {
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

  // …but the ticker call object is untouched: still status=answered with no
  // duration, i.e. rendered as a live 'Talking' call forever (no call.updated
  // broadcast either — the sweeper only sends stats messages).
  const ticker = getTeamRecentCalls(customerId, teamId);
  assert.equal(tickerTalking(ticker).length, 1, "ticker still shows the call as Talking after sweep");
  assert.equal(getCall(customerId, call.id)!.status, "answered", "call object never marked ended");
});

// ---------------------------------------------------------------------------
// FINDING 2 — Divergence WINDOW before the sweep: N dropped call.ended
// webhooks inflate BOTH sides equally at first, but any mix of drops at
// different times produces ticker>KPI as soon as the sweep catches the older
// ones. Reproduces the screenshot's 4 KPI vs 6 ticker.
// ---------------------------------------------------------------------------
test("F2: screenshot repro — 6 ticker 'Talking' vs 4 KPI after sweep catches 2 older orphans", () => {
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
  assert.equal(tickerTalking(ticker).length, 6, "ticker shows 6 'Talking' calls");
});

// ---------------------------------------------------------------------------
// FINDING 3 — Rollover removes the call from the losing team's ACTIVE counter
// but never from its callIds set, so on a page refresh (team.init snapshot)
// the losing team's ticker still lists the call — as a LIVE call, because the
// shared call object's status is still "active" for the new team.
// ---------------------------------------------------------------------------
test("F3: rollover — losing team's ticker still lists the call as live on refresh", () => {
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

  // Team A's KPI: 0 active. Team A's ticker snapshot: still contains the call,
  // status "active" → rendered as a live Ringing call.
  assert.equal(getTeamStats(customerId, teamA).active, 0, "team A active counter cleared");
  const tickerA = getTeamRecentCalls(customerId, teamA);
  assert.equal(tickerA.length, 1, "call still in team A ticker snapshot");
  assert.equal(tickerLive(tickerA).length, 1, "…and rendered as LIVE for team A");
  // (Connected clients get a call.not_answered patch; any refresh/reconnect
  // reloads this snapshot and resurrects the live row.)
});

// ---------------------------------------------------------------------------
// FINDING 4 — Roster: availability is never reconciled with live calls. An
// agent can show "Available" (green) while named as the agent on a live
// answered call for the team.
// ---------------------------------------------------------------------------
test("F4: Available-while-talking — dropped/out-of-order busy availability leaves agent green on a live call", () => {
  const { customerId, teamId } = ids();

  updateTeamAvailability(customerId, teamId, summary(teamId), [agent("agent-1", "available")]);

  // Live answered call handled by agent-1 (call.answered carried assignedUser).
  const call = mkCall("c-avail", { status: "answered", teamId, agentId: "agent-1", agentName: "agent-1" });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", call.timestamp);
  teamStatsNewCall(customerId, teamId, call.id, "inbound", call.timestamp);
  statsAnswer(customerId, call.id, "inbound");
  teamStatsAnswer(customerId, teamId, call.id, "inbound");

  // The 'busy' user.availability.updated webhook was DROPPED (or arrived
  // before the answer and was overwritten by a later 'available'). Nothing in
  // the state layer cross-checks the roster against live calls:
  const roster = (updateUserAvailabilityAcrossTeams(customerId, "agent-1", agent("agent-1", "available")), // late 'available'
    getTeamStats(customerId, teamId));
  assert.equal(roster.talking, 1, "team has a live talking call");

  const ticker = getTeamRecentCalls(customerId, teamId);
  const live = tickerLive(ticker);
  assert.equal(live[0]?.agentId, "agent-1", "the live call names agent-1");

  // Roster still says Available — the exact screenshot symptom. (The frontend
  // getAgentStatusInfo maps status 'available' → green 'Available' with no
  // cross-check against `calls`; the activeCall lookup at TeamWallboard.tsx:290
  // only runs for busy/ringing agents.)
  // We assert the state layer keeps the stale value:
  const teamState = getTeamState(customerId, teamId);
  assert.equal(teamState!.agents[0].availability.status, "available", "roster shows Available while agent is on a live call");
});

// ---------------------------------------------------------------------------
// FINDING 5 — Ticker cap can evict a LIVE answered call (only status==='active'
// is protected by trimOldCalls) → KPI > ticker, the opposite drift direction.
// ---------------------------------------------------------------------------
test("F5: >100-call cap evicts a live ANSWERED call from the ticker while KPI still counts it", () => {
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
  assert.equal(getCall(customerId, live.id), undefined, "…but the live answered call was evicted from the ticker buffer");
  assert.equal(getTeamRecentCalls(customerId, teamId).length, 0, "team ticker snapshot is empty");
});

// ---------------------------------------------------------------------------
// FINDING 6 — Dropped availability 'ringing' update misclassifies a ringing
// call as 'Talking' in the KPI while the ticker shows it as 'Ringing'.
// ---------------------------------------------------------------------------
test("F6: dropped ringing-availability webhook — KPI says Talking, ticker says Ringing", () => {
  const { customerId, teamId } = ids();
  // call.started attributed to the team via assignedCallGroup (NOT via the
  // data action, which would start a wait timer). No availability update ever
  // marks an agent ringing on it.
  const call = mkCall("c-ringing", { status: "active", teamId });
  addCall(customerId, call);
  statsNewCall(customerId, call.id, "inbound", call.timestamp);
  teamStatsNewCall(customerId, teamId, call.id, "inbound", call.timestamp);

  const s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 0, "KPI ringing misses the call (no waitingCalls entry)");
  assert.equal(s.talking, 1, "KPI counts the un-answered call as Talking");
  const ticker = getTeamRecentCalls(customerId, teamId);
  assert.equal(ticker[0].status, "active", "ticker renders the same call as Ringing");
});

// ---------------------------------------------------------------------------
// FINDING 7 (scope check) — Teams Board ringing aggregation: only teams whose
// ids are passed in are aggregated (disabled teams excluded), and DID calls
// never enter team stats.
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
// FINDING 8 — Company/global level: the same dropped-call.ended drift applies;
// the sweep heals the KPI counter but the customer dashboard ticker keeps the
// live-looking call. Company stats include both directions.
// ---------------------------------------------------------------------------
test("F8: company-level KPI heals on sweep, company ticker does not; both directions counted", () => {
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
  assert.equal(live.length, 2, "customer ticker still shows both calls as live");
});
