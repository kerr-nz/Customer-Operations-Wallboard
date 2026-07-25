import test from "node:test";
import assert from "node:assert/strict";

import {
  addCall,
  getCall,
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
import type { CallData, TeamAgent, TeamSummary } from "@shared/schema";

let uid = 0;
function ids() {
  uid += 1;
  return { customerId: `cust-${uid}-${Date.now()}`, teamId: `team-${uid}` };
}

// Live KPIs (active/ringing/talking) are now DERIVED from the canonical call
// objects (isLiveCall over todayCalls), so tests register the call object the
// way routes.ts does: addCall() alongside the stats counters, and mutate the
// object's status on answer/end.
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

test("answered call lifecycle: new(ringing) -> answered/talking -> ended", () => {
  const { customerId, teamId } = ids();
  const callId = "call-answered";

  // 1. New call arrives: live and RINGING (not yet answered). The call object
  //    is the evidence — no availability webhook needed.
  const call = mkCall(callId, { teamId });
  addCall(customerId, call);
  teamStatsNewCall(customerId, teamId, callId, "inbound");
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.total, 1, "total counts the new call");
  assert.equal(s.active, 1, "call is live");
  assert.equal(s.ringing, 1, "un-answered live call counts as ringing");
  assert.equal(s.talking, 0, "nothing connected yet");

  // 2. Agent's phone starts ringing — no change to the derived split.
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.active, 1, "still one live call");
  assert.equal(s.ringing, 1, "still ringing");
  assert.equal(s.talking, 0, "nothing connected while ringing");

  // 3. Call is answered: status flips on the call object.
  call.status = "answered";
  teamStatsAnswer(customerId, teamId, callId, "inbound");
  s = getTeamStats(customerId, teamId);
  assert.equal(s.answered, 1, "answered increments");
  assert.equal(s.inboundAnswered, 1, "inbound answered increments");
  assert.equal(s.ringing, 0, "ringing cleared once answered");
  assert.equal(s.talking, 1, "call is now connected/talking");

  // 4. Call ends.
  call.status = "ended";
  call.duration = 120;
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

  const call = mkCall(callId, { teamId });
  addCall(customerId, call);
  teamStatsNewCall(customerId, teamId, callId, "inbound");
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "call is ringing");
  assert.equal(s.talking, 0, "not connected");

  // Call ends unanswered.
  call.status = "missed";
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
  const ans = mkCall("c-ans", { teamId });
  addCall(customerId, ans);
  teamStatsNewCall(customerId, teamId, "c-ans", "inbound");
  ans.status = "answered";
  teamStatsAnswer(customerId, teamId, "c-ans", "inbound");
  ans.status = "ended";
  ans.duration = 60;
  teamStatsEndCall(customerId, teamId, "c-ans", "answered", 60);

  // Missed call.
  const miss = mkCall("c-miss", { teamId });
  addCall(customerId, miss);
  teamStatsNewCall(customerId, teamId, "c-miss", "inbound");
  miss.status = "missed";
  teamStatsEndCall(customerId, teamId, "c-miss", "missed", null);

  // Still-live call (should NOT count toward completed).
  addCall(customerId, mkCall("c-live", { teamId, direction: "outbound" }));
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
  // webhook. Availability no longer drives the KPI counts at all — without a
  // live call object attributed to the team, everything stays 0.
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
  addCall(customerId, mkCall("phantom-1", { teamId }));
  teamStatsNewCall(customerId, teamId, "phantom-1", "inbound");
  const s2 = getTeamStats(customerId, teamId);
  assert.equal(s2.active, 1, "the call is now live");
  assert.equal(s2.ringing, 1, "the now-live ringing call is counted");
  assert.equal(s2.talking, 0, "still ringing, not connected");
  assert.ok(s2.talking >= 0, "talking is non-negative");
});

test("getTeamCompleted never goes negative", () => {
  // Defensive: even if active somehow exceeds total, completed clamps at 0.
  assert.equal(getTeamCompleted({ total: 0, active: 3 }), 0, "clamped at 0");
  assert.equal(getTeamCompleted(undefined), 0, "undefined stats -> 0");
  assert.equal(getTeamCompleted({ total: 5, active: 2 }), 3, "normal case");
});

test("ringing persists until the call is actually answered (availability alone cannot flip it)", () => {
  const { customerId, teamId } = ids();
  const callId = "call-avail";

  const call = mkCall(callId, { teamId });
  addCall(customerId, call);
  teamStatsNewCall(customerId, teamId, callId, "inbound");
  updateTeamAvailability(customerId, teamId, summary(teamId), [ringingAgent("agent-1", callId)]);
  let s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "ringing while un-answered");
  assert.equal(s.talking, 0, "not connected yet");

  // Availability flips to idle, but no call.answered webhook yet: the call
  // object is still un-answered, so it stays ringing (no misclassification
  // when an availability update is dropped or reordered).
  updateTeamAvailability(customerId, teamId, summary(teamId), [idleAgent("agent-1")]);
  s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 1, "still ringing until answered");
  assert.equal(s.active, 1, "call still live");
  assert.equal(s.talking, 0, "not talking until answered");

  // The call.answered webhook lands: now it is talking.
  call.status = "answered";
  teamStatsAnswer(customerId, teamId, callId, "inbound");
  s = getTeamStats(customerId, teamId);
  assert.equal(s.ringing, 0, "ringing cleared once answered");
  assert.equal(s.talking, 1, "now counted as talking");
});

test("getAllTeamStats returns the same derived ringing/talking per team", () => {
  const { customerId } = ids();
  const teamA = "team-a";
  const teamB = "team-b";

  // Team A: one ringing call.
  addCall(customerId, mkCall("a1", { teamId: teamA }));
  teamStatsNewCall(customerId, teamA, "a1", "inbound");
  updateTeamAvailability(customerId, teamA, summary(teamA), [ringingAgent("a-agent", "a1")]);

  // Team B: one answered/talking call.
  const b1 = mkCall("b1", { teamId: teamB });
  addCall(customerId, b1);
  teamStatsNewCall(customerId, teamB, "b1", "inbound");
  b1.status = "answered";
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

test("sweepStaleCalls force-ends stale calls at tenant and team level, leaves fresh calls", () => {
  const { customerId, teamId } = ids();
  const now = Date.now();

  // Stale call: started long before the STALE_CALL_MS window. Its call.ended
  // webhook never arrived.
  const staleCallId = "call-stale";
  const staleStartedAt = now - STALE_CALL_MS - 1000;
  addCall(customerId, mkCall(staleCallId, { teamId, timestamp: staleStartedAt }));
  statsNewCall(customerId, staleCallId, "inbound", staleStartedAt);
  teamStatsNewCall(customerId, teamId, staleCallId, "inbound", staleStartedAt);

  // Fresh call: started just now, well within the window.
  const freshCallId = "call-fresh";
  addCall(customerId, mkCall(freshCallId, { teamId, timestamp: now }));
  statsNewCall(customerId, freshCallId, "inbound", now);
  teamStatsNewCall(customerId, teamId, freshCallId, "inbound", now);

  // Both calls are live before the sweep.
  assert.equal(getStats(customerId).active, 2, "two live tenant calls before sweep");
  assert.equal(getTeamStats(customerId, teamId).active, 2, "two live team calls before sweep");

  const results = sweepStaleCalls(STALE_CALL_MS, now);

  // The stale call is gone from KPIs; the fresh call is untouched at both levels.
  assert.equal(getStats(customerId).active, 1, "only the fresh tenant call remains");
  assert.equal(getTeamStats(customerId, teamId).active, 1, "only the fresh team call remains");

  // The stale CALL OBJECT was force-ended too (ticker heals with the KPI).
  assert.equal(getCall(customerId, staleCallId)!.status, "missed", "stale ringing call marked missed");
  assert.equal(getCall(customerId, freshCallId)!.status, "active", "fresh call untouched");

  // The result reports exactly the removed call id and the affected team.
  const result = results.find(r => r.customerId === customerId);
  assert.ok(result, "sweep returns a result for the affected customer");
  assert.deepEqual(result!.removedTenantCallIds, [staleCallId], "reports the removed stale call id");
  assert.ok(!result!.removedTenantCallIds.includes(freshCallId), "does not report the fresh call");
  assert.ok(result!.affectedTeamIds.has(teamId), "reports the affected team id");
  assert.deepEqual(result!.endedCalls.map(c => c.id), [staleCallId], "reports the force-ended call object");
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

  const call = mkCall(callId);
  addCall(customerId, call);
  statsNewCall(customerId, callId, "inbound", Date.now());
  // call.not_answered lands mid-rollover and prematurely ends the call
  // (routes marks the call object missed alongside the counter).
  call.status = "missed";
  statsEndCall(customerId, callId, "missed", null);
  let s = getStats(customerId);
  assert.equal(s.missed, 1, "premature miss counted");
  assert.equal(s.active, 0, "call removed from active");

  // The next team's data action proves the call is still live → revive
  // (routes flips the call object back to active).
  statsReviveCall(customerId, callId);
  call.status = "active";
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
  addCall(customerId, mkCall(callId, { teamId, timestamp: now }));
  statsNewCall(customerId, callId, "inbound", now);
  teamStatsNewCall(customerId, teamId, callId, "inbound", now);

  const results = sweepStaleCalls(STALE_CALL_MS, now);

  assert.equal(getStats(customerId).active, 1, "fresh tenant call still live");
  assert.equal(getTeamStats(customerId, teamId).active, 1, "fresh team call still live");
  const result = results.find(r => r.customerId === customerId);
  assert.equal(result, undefined, "no result emitted for a tenant with no stale calls");
});
