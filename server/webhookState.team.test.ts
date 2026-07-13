import test from "node:test";
import assert from "node:assert/strict";

import {
  teamStatsNewCall,
  teamStatsAnswer,
  teamStatsEndCall,
  teamAttributeRingingCall,
  teamRolloverMiss,
  teamStatsRecordWait,
  getTeamRingStart,
  updateTeamAvailability,
  getTeamStats,
  getAllTeamStats,
  statsNewCall,
  statsEndCall,
  statsReviveCall,
  getStats,
  sweepStaleCalls,
  STALE_CALL_MS,
} from "./webhookState";
import { getTeamCompleted } from "../client/src/lib/teamStats";
import type { TeamAgent, TeamSummary } from "@shared/schema";

let uid = 0;
function ids() {
  uid += 1;
  return { customerId: `cust-${uid}-${Date.now()}`, teamId: `team-${uid}` };
}

function summary(teamId: string, overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: teamId,
    displayName: teamId,
    totalMembers: 1,
    totalAvailable: 1,
    status: "available",
    availabilitySummary: "1 of 1 available",
    ...overrides,
  };
}

// Builds an agent that is "ringing" on a given call, which is what drives the
// team's live ringing count (waitingCalls) via updateTeamAvailability.
function ringingAgent(agentId: string, callId: string): TeamAgent {
  return {
    id: agentId,
    displayName: agentId,
    firstName: agentId,
    lastName: "",
    email: `${agentId}@example.com`,
    loginStatus: "loggedIn",
    availability: {
      status: "ringing",
      statusAt: new Date().toISOString(),
      statusTimestamp: Date.now(),
      availabilitySummary: "ringing",
      callId,
    },
  };
}

function idleAgent(agentId: string): TeamAgent {
  return {
    id: agentId,
    displayName: agentId,
    firstName: agentId,
    lastName: "",
    email: `${agentId}@example.com`,
    loginStatus: "loggedIn",
    availability: {
      status: "available",
      statusAt: new Date().toISOString(),
      statusTimestamp: Date.now(),
      availabilitySummary: "available",
    },
  };
}

test("answered call lifecycle: new -> ringing -> answered/talking -> ended", () => {
  const { customerId, teamId } = ids();
  const callId = "call-answered";

  // 1. New call arrives: it is live (active) but not yet ringing (no agent
  //    availability update has landed).
  teamStatsNewCall(customerId, teamId, callId, "inbound");
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.total, 1, "total counts the new call");
  assert.equal(s.active, 1, "call is live");
  assert.equal(s.ringing, 0, "no ringing agent yet");
  assert.equal(s.talking, 1, "talking = active - ringing");

  // 2. Agent's phone starts ringing on this call.
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 1, "still one live call");
  assert.equal(s.ringing, 1, "ringing reflects the waiting call");
  assert.equal(s.talking, 0, "nothing connected while ringing");

  // 3. Call is answered: ringing drops to 0, the call is now talking.
  teamStatsAnswer(customerId, teamId, callId, "inbound");
  s = getTeamStats(customerId, teamId);
  assert.equal(s.answered, 1, "answered increments");
  assert.equal(s.inboundAnswered, 1, "inbound answered increments");
  assert.equal(s.ringing, 0, "ringing cleared once answered");
  assert.equal(s.talking, 1, "call is now connected/talking");

  // 4. Call ends.
  teamStatsEndCall(customerId, teamId, callId, "answered", 120);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 0, "no live calls after end");
  assert.equal(s.ringing, 0, "no ringing after end");
  assert.equal(s.talking, 0, "no talking after end");
  assert.equal(s.missed, 0, "answered call is not missed");
  assert.equal(getTeamCompleted(s), 1, "the finished call counts as completed");
});

test("missed call lifecycle: new -> ringing -> ended(missed) counts into completed", () => {
  const { customerId, teamId } = ids();
  const callId = "call-missed";

  teamStatsNewCall(customerId, teamId, callId, "inbound");
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "call is ringing");
  assert.equal(s.talking, 0, "not connected");

  // Call ends unanswered.
  teamStatsEndCall(customerId, teamId, callId, "missed", null);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 0, "no live calls");
  assert.equal(s.ringing, 0, "ringing cleared on end");
  assert.equal(s.talking, 0, "not talking");
  assert.equal(s.answered, 0, "was never answered");
  assert.equal(s.missed, 1, "counted as missed");
  assert.equal(getTeamCompleted(s), 1, "missed call still counts as completed (finished)");
});

test("completed equals answered + missed across a mix of calls", () => {
  const { customerId, teamId } = ids();

  // Answered call.
  teamStatsNewCall(customerId, teamId, "c-ans", "inbound");
  teamStatsAnswer(customerId, teamId, "c-ans", "inbound");
  teamStatsEndCall(customerId, teamId, "c-ans", "answered", 60);

  // Missed call.
  teamStatsNewCall(customerId, teamId, "c-miss", "inbound");
  teamStatsEndCall(customerId, teamId, "c-miss", "missed", null);

  // Still-live call (should NOT count toward completed).
  teamStatsNewCall(customerId, teamId, "c-live", "outbound");

  const s = getTeamStats(customerId, teamId);
  assert.equal(s.total, 3, "three calls total");
  assert.equal(s.active, 1, "one still live");
  assert.equal(s.answered, 1, "one answered");
  assert.equal(s.missed, 1, "one missed");
  assert.equal(
    getTeamCompleted(s),
    s.answered + s.missed,
    "completed = answered + missed (finished calls only)",
  );
  assert.equal(getTeamCompleted(s), 2, "two finished calls");
});

test("phantom ringing (no matching live call) does not inflate ringing or push talking negative", () => {
  const { customerId, teamId } = ids();

  // A ringing availability update can arrive before the matching call.started
  // webhook, landing call ids in waitingCalls that are not yet active. These
  // phantom entries must not be counted as ringing (which would overstate
  // ringing and force talking to clamp at 0).
  updateTeamAvailability(customerId, teamId, summary(teamId, { totalMembers: 2, totalAvailable: 2 }), [
    ringingAgent("agent-1", "phantom-1"),
    ringingAgent("agent-2", "phantom-2"),
  ]);

  const s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 0, "no registered live calls");
  assert.equal(s.ringing, 0, "phantom ringing calls are not counted as ringing");
  assert.equal(s.talking, 0, "talking is 0 with no live calls");
  assert.ok(s.talking >= 0, "talking is non-negative");

  // Once the matching call.started arrives, the ringing call becomes real.
  teamStatsNewCall(customerId, teamId, "phantom-1", "inbound");
  const s2 = getTeamStats(customerId, teamId);
  assert.equal(s2.active, 1, "the call is now live");
  assert.equal(s2.ringing, 1, "the now-active ringing call is counted");
  assert.equal(s2.talking, 0, "still ringing, not connected");
  assert.ok(s2.talking >= 0, "talking is non-negative");
});

test("getTeamCompleted never goes negative", () => {
  // Defensive: even if active somehow exceeds total, completed clamps at 0.
  assert.equal(getTeamCompleted({ total: 0, active: 3 }), 0, "clamped at 0");
  assert.equal(getTeamCompleted(undefined), 0, "undefined stats -> 0");
  assert.equal(getTeamCompleted({ total: 5, active: 2 }), 3, "normal case");
});

test("ringing clears when the agent stops ringing (availability update)", () => {
  const { customerId, teamId } = ids();
  const callId = "call-avail";

  teamStatsNewCall(customerId, teamId, callId, "inbound");
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "ringing while agent phone rings");
  assert.equal(s.talking, 0, "not connected yet");

  // Agent picks up: availability no longer shows ringing -> waitingCalls clears.
  updateTeamAvailability(customerId, teamId, summary(teamId), [idleAgent("agent-1")]);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 0, "ringing cleared by availability update");
  assert.equal(s.active, 1, "call still live");
  assert.equal(s.talking, 1, "now counted as talking");
});

test("getAllTeamStats returns the same derived ringing/talking per team", () => {
  const { customerId } = ids();
  const teamA = "team-a";
  const teamB = "team-b";

  // Team A: one ringing call.
  teamStatsNewCall(customerId, teamA, "a1", "inbound");
  updateTeamAvailability(customerId, teamA, summary(teamA), [ringingAgent("a-agent", "a1")]);

  // Team B: one answered/talking call.
  teamStatsNewCall(customerId, teamB, "b1", "inbound");
  teamStatsAnswer(customerId, teamB, "b1", "inbound");

  const all = getAllTeamStats(customerId);
  assert.equal(all[teamA].ringing, 1, "team A ringing");
  assert.equal(all[teamA].talking, 0, "team A not talking");
  assert.equal(all[teamB].ringing, 0, "team B not ringing");
  assert.equal(all[teamB].talking, 1, "team B talking");

  // Matches the single-team accessor.
  assert.deepEqual(
    { ringing: all[teamA].ringing, talking: all[teamA].talking },
    { ringing: getTeamStats(customerId, teamA).ringing, talking: getTeamStats(customerId, teamA).talking },
  );
});

test("sweepStaleCalls evicts stale active calls at tenant and team level, leaves fresh calls", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();

  // Stale call: started long before the STALE_CALL_MS window. Its call.ended
  // webhook never arrived, so it still sits in activeCallIds inflating counts.
  const staleCallId = "call-stale";
  const staleStartedAt = now - STALE_CALL_MS - 1000;
  statsNewCall(customerId, staleCallId, "inbound", staleStartedAt);
  teamStatsNewCall(customerId, teamId, staleCallId, "inbound", staleStartedAt);

  // Fresh call: started just now, well within the window.
  const freshCallId = "call-fresh";
  statsNewCall(customerId, freshCallId, "inbound", now);
  teamStatsNewCall(customerId, teamId, freshCallId, "inbound", now);

  // Both calls are live before the sweep.
  assert.equal(getStats(customerId).active, 2, "two live tenant calls before sweep");
  assert.equal(getTeamStats(customerId, teamId).active, 2, "two live team calls before sweep");

  const results = sweepStaleCalls(STALE_CALL_MS, now);

  // The stale call is gone; the fresh call is untouched at both levels.
  assert.equal(getStats(customerId).active, 1, "only the fresh tenant call remains");
  assert.equal(getTeamStats(customerId, teamId).active, 1, "only the fresh team call remains");

  // The result reports exactly the removed call id and the affected team.
  const result = results.find(r => r.customerId === customerId);
  assert.ok(result, "sweep returns a result for the affected customer");
  assert.deepEqual(result!.removedTenantCallIds, [staleCallId], "reports the removed stale call id");
  assert.ok(!result!.removedTenantCallIds.includes(freshCallId), "does not report the fresh call");
  assert.ok(result!.affectedTeamIds.has(teamId), "reports the affected team id");
});

test("rollover credits ring time to the missed team's wait stats", () => {
  const { customerId, teamId } = ids();
  const callId = "call-rollover-wait";

  // Data action attributes the ringing call to team A (starts its wait timer).
  teamAttributeRingingCall(customerId, teamId, callId, "inbound");
  const ringStart = getTeamRingStart(customerId, teamId, callId);
  assert.ok(ringStart, "wait timer started on attribution");

  // 30 seconds later the queue rolls over: team A missed it, and the 30s it
  // rang there counts into team A's average wait time.
  teamRolloverMiss(customerId, teamId, callId, ringStart! + 30_000);
  const s = getTeamStats(customerId, teamId);
  assert.equal(s.missed, 1, "rollover counts as missed for the team");
  assert.equal(s.active, 0, "call left the team's queue");
  assert.equal(s.totalWaitTime, 30, "ring time credited to wait stats");
  assert.equal(s.answeredWithWait, 1, "one wait sample counted");
});

test("missed call via teamStatsEndCall credits ring time to wait stats, without double-counting on repeat", () => {
  const { customerId, teamId } = ids();
  const callId = "call-missed-wait";

  teamAttributeRingingCall(customerId, teamId, callId, "inbound");
  const ringStart = getTeamRingStart(customerId, teamId, callId)!;

  // Queue timeout reported via call.not_answered → missed after 20s of ringing.
  teamStatsEndCall(customerId, teamId, callId, "missed", null, ringStart + 20_000);
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.missed, 1, "missed counted");
  assert.equal(s.totalWaitTime, 20, "20s ring time credited");
  assert.equal(s.answeredWithWait, 1, "one wait sample");

  // A later duplicate end (e.g. call.ended) must not add another sample —
  // the wait timer is gone, so nothing more is credited.
  teamStatsEndCall(customerId, teamId, callId, "missed", null, ringStart + 60_000);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.totalWaitTime, 20, "wait unchanged on duplicate end");
  assert.equal(s.answeredWithWait, 1, "still one wait sample");
  assert.equal(s.missed, 1, "missed not double-counted");
});

test("statsReviveCall undoes a premature miss and restores the live/ringing call", () => {
  const { customerId } = ids();
  const callId = "call-revive";

  statsNewCall(customerId, callId, "inbound", Date.now());
  // call.not_answered lands mid-rollover and prematurely ends the call.
  statsEndCall(customerId, callId, "missed", null);
  let s = getStats(customerId);
  assert.equal(s.missed, 1, "premature miss counted");
  assert.equal(s.active, 0, "call removed from active");

  // The next team's data action proves the call is still live → revive.
  statsReviveCall(customerId, callId);
  s = getStats(customerId);
  assert.equal(s.missed, 0, "premature miss undone");
  assert.equal(s.active, 1, "call live again");
  assert.equal(s.ringing, 1, "call ringing again");
});

test("answered team's local wait replaces nothing and payload wait cannot overwrite it once counted", () => {
  const { customerId, teamId } = ids();
  const callId = "call-local-wait";

  // Rolled-over call reaches this team; rings 8s locally before the answer.
  teamAttributeRingingCall(customerId, teamId, callId, "inbound");
  const ringStart = getTeamRingStart(customerId, teamId, callId)!;
  teamStatsAnswer(customerId, teamId, callId, "inbound");
  teamStatsRecordWait(customerId, teamId, callId, (ringStart + 8_000 - ringStart) / 1000);

  let s = getTeamStats(customerId, teamId);
  assert.equal(s.totalWaitTime, 8, "team-local wait recorded");

  // If a later event records a different wait, replacement semantics keep a
  // single sample (never double-counts).
  teamStatsRecordWait(customerId, teamId, callId, 10);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.totalWaitTime, 10, "later value replaces, not adds");
  assert.equal(s.answeredWithWait, 1, "still one wait sample");
});

test("sweepStaleCalls leaves everything untouched when no calls are stale", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();

  const callId = "call-fresh-only";
  statsNewCall(customerId, callId, "inbound", now);
  teamStatsNewCall(customerId, teamId, callId, "inbound", now);

  const results = sweepStaleCalls(STALE_CALL_MS, now);

  assert.equal(getStats(customerId).active, 1, "fresh tenant call still live");
  assert.equal(getTeamStats(customerId, teamId).active, 1, "fresh team call still live");
  const result = results.find(r => r.customerId === customerId);
  assert.equal(result, undefined, "no result emitted for a tenant with no stale calls");
});
