# Diagnosis: Team Wallboard KPI / Ticker / Roster Drift

**Status:** diagnosis only — no production logic was changed.
**Evidence:** every finding below is reproduced by an automated replay test in
`server/driftDiagnosis.test.ts` (run: `npx tsx --test server/driftDiagnosis.test.ts`; all 8 pass).
Test names F1–F8 are referenced per finding.

## Symptom under investigation

On a customer's single-team wallboard, three displays disagreed:
- "Active" (in conversation) KPI said **4**
- the calls ticker showed **6** calls in "Talking" state
- **4 agents named on those live calls** showed green **"Available"** in the roster

## Working thesis — CONFIRMED

The three displays come from three independent data sources that are never reconciled:

| Display | Source of truth |
|---|---|
| KPI "Active/Talking" | `team.stats.active` = size of `team.activeCallIds` map, minus derived `ringing` (`withLiveCounts`, `server/webhookState.ts:1103`) |
| Ticker rows & their "Talking" label | `CallData` objects in `tenant.todayCalls`, filtered by `team.callIds`; "live" = `status === "active" || (status === "answered" && duration == null)` (`TeamWallboard.tsx:355,411`) |
| Roster status dots | `team.agents[].availability.status`, written only by `team.availability.updated` / `user.availability.updated` webhooks (`routes.ts:2476/2535`) |

Nothing cross-checks any pair of them. Below, each divergence path with the
event sequence that triggers it.

## 1. Divergence matrix (which event paths update which source)

| Event path | team activeCallIds (KPI) | ticker call object | roster availability |
|---|---|---|---|
| `call.started` (with team) | add | create, status `active` | — |
| `call.answered` | — (stays active) | status → `answered` | — |
| `call.ended` / `call.hungup` | remove | status/duration set | — |
| `call.not_answered` | remove | status → `missed` | — |
| Data-action rollover (`applyTeamCallDataAction`) | remove from prev team, add to new team | `teamId` mutated; **stays in prev team's `callIds`** | — |
| Pending-assignment application | add | `teamId` set | — |
| 90-min stale sweep (`sweepStaleCalls`) | remove | **untouched** (no status change, no `call.updated` broadcast — sweeper sends stats only, `routes.ts:673-682`) | — |
| Midnight reset | cleared | cleared | kept |
| Server restart | cleared (rebuilt from DB with `active = 0`) | cleared | empty until next availability webhook |
| `*.availability.updated` | — (only `waitingCalls` ringing set) | agent name patched onto call (`routes.ts:2561`) | replace |

Any dropped, duplicated, or out-of-order webhook updates one column and not the
others; only the sweep pulls the *counter* back — never the ticker or roster.

## 2. Findings

### F1 — Dropped `call.ended`: ticker shows "Talking" **indefinitely** (confirmed logic bug in self-healing)
If `call.ended` never arrives, both KPI and ticker are wrong for 90 minutes.
The sweep then removes the call from `activeCallIds` (KPI heals) but **never
touches the `CallData` object** — it stays `status: "answered", duration: null`,
which the ticker renders as a live "Talking" call forever (until midnight reset).
The sweeper also broadcasts only `stats.update`/`team.stats`, never `call.updated`,
so even connected clients keep the live row. *Test: F1.*

### F2 — The screenshot's "4 vs 6" is exactly this mechanism (confirmed)
Two calls whose `call.ended` was dropped >90 min ago plus four genuinely live
calls yields **KPI = 4, ticker "Talking" = 6** after one sweep pass. *Test: F2.*
Classification: **dropped-webhook data issue that the code half-heals** — it fixes
the counter side only, guaranteeing a visible mismatch instead of preventing one.

### F3 — Rollover leaves a live ticker entry on the losing team (confirmed logic bug)
`teamRolloverMiss` removes the call from the losing team's `activeCallIds` but
**not from `team.callIds`**, and the shared call object stays `status:"active"`
(it is still ringing — for the *new* team). Connected clients get a
`call.not_answered` patch, but any refresh/reconnect reloads the
`team.init` snapshot from `getTeamRecentCalls`, which resurrects the call as a
live "Ringing" row on the losing team's board while its KPI says 0. *Test: F3.*

### F4 — "Available" while named on a live call (confirmed: no roster-vs-calls reconciliation)
The roster is written only by availability webhooks. Sequences producing the
screenshot symptom:
- the `busy` `user.availability.updated` for the agent is **dropped**;
- or it arrives **before** `call.answered` and a later `available` update
  (wrap-up finished at Spoke's end, or a duplicate/stale event) overwrites it
  while the call object is still live because its `call.ended` was dropped (F1) —
  the two data losses compound: a permanently-"Talking" ticker call whose agent
  correctly went back to Available.
Nothing cross-checks: `getAgentStatusInfo` (TeamWallboard.tsx:187) maps
`available` → green with no look at `calls`; the active-call lookup at line 290
only runs for busy/ringing agents. `handleUserAvailability` even patches the
agent's name *onto* ticker calls (routes.ts:2561) but never the reverse. *Test: F4.*
Classification: **dropped/out-of-order data issue with no self-healing**; the
4-agents-Available-on-6-"Talking"-calls screenshot is the expected steady state
of F1 + F4 combined.

### F5 — Ticker cap can evict a LIVE answered call → KPI **higher** than ticker (confirmed logic bug)
`trimOldCalls` (webhookState.ts:163) protects only `status === "active"` calls
from the 100-call cap. A live *answered* (talking) call with an old timestamp is
evicted once 100 newer calls arrive, while the KPI still counts it. Drift in the
opposite direction. *Test: F5.*

### F6 — Dropped `ringing` availability update: KPI calls it "Talking", ticker calls it "Ringing" (confirmed)
`talking = active − ringing`, where `ringing` requires a `waitingCalls` entry
(created by availability webhooks or the data action). A team call attributed
via `assignedCallGroup` on `call.started`, with no availability update, counts
as **Talking** in the KPI while the ticker shows **Ringing**. *Test: F6.*

### F7 — Teams Board scope rules: **no violation found**
- "Calls Ringing" aggregates `ts.ringing` over **enabled teams only**
  (`TeamBoard.tsx:77` passes `enabledTeams` ids to `aggregateTeamStats`);
  disabled teams' ringing is excluded.
- DID (person-bound) calls never enter team stats (`teamStatsNewCall` is only
  called with a team attribution), so they cannot appear in any team's ringing.
- Phantom protection: availability-driven `waitingCalls` entries not present in
  `activeCallIds` are excluded from `ringing` (`withLiveCounts`). *Test: F7.*

### F8 — Company/global levels: same drift mechanism; aggregation scope correct
- Customer-level `dailyStats.active` has the identical dropped-`call.ended`
  behaviour: sweep heals the KPI at 90 min, the Dashboard ticker keeps the
  live-looking call (same `status === "answered" && duration == null` predicate
  in `CallFeed`/`Dashboard`). *Test: F8.*
- Company aggregation counts **both inbound and outbound**, for calls to both
  people (DID) and teams — `statsNewCall` runs for every non-internal call
  regardless of team attribution. Global wallboard sums all tenants
  (`getGlobalStats`), both directions. **Rules validated, no violation.**
- Call-type model: inbound/outbound DID and inbound team calls are all handled;
  outbound team calls are not distinguished anywhere (noted as unsupported).

## 3. Classification of the screenshot symptoms

| Symptom | Classification |
|---|---|
| Ticker 6 vs KPI 4 | **Dropped-`call.ended` data issue the code fails to fully self-heal** (F1/F2). The sweep is one-sided by design — counter yes, ticker no. Confirmed reproducible; not inconclusive. |
| 4 agents "Available" while named on live "Talking" calls | **Confirmed absence of roster↔calls reconciliation** (F4), compounded by F1: those ticker calls were very likely already over. |

## 4. Recommended fixes (for the follow-up task, in priority order)

1. **Make the stale sweep heal the ticker too:** when sweeping a call, also mark
   its `CallData` ended (e.g. `status: "ended"`, synthesize a duration or a
   "timed out" marker) and broadcast `call.updated`/`call.ended` to team +
   customer + global channels. This alone removes the 4-vs-6 class of mismatch.
2. **Derive the KPI and the ticker's live set from one source:** either drive the
   "Talking" KPI from the ticker's live predicate, or (better) have the ticker
   consult `activeCallIds` — one truth, zero drift by construction.
3. **Rollover hygiene:** on `teamRolloverMiss`, snapshot a completed/missed copy
   for the losing team (or remove the id from `team.callIds`) so `team.init`
   refreshes don't resurrect a live row (F3).
4. **Protect live answered calls from the 100-call cap** in `trimOldCalls`
   (treat "answered with no duration" the same as "active") (F5).
5. **Roster reconciliation + "On another call" label:** when rendering (or on a
   periodic server-side pass), if an agent with status `available` is named
   (`agentId` or `availability.callId`) on a live call **of this team**, show
   them as on a call; if their `availability.callId` points at a live call that
   is *not* this team's, show **"On another call"** (covers other-team/personal
   calls). Server-side reconciliation is preferable so the Teams Board and
   availability summaries stay consistent too.
6. (Minor, F6) When a team call is attributed without any ringing evidence,
   consider it ringing until answered (start a `waitingCalls` timer on
   `teamStatsNewCall` for unanswered calls) so KPI "Talking" matches the ticker's
   Ringing/Talking split.

## 5. How to re-run the evidence

```bash
npx tsx --test server/driftDiagnosis.test.ts   # 8/8 pass — each F# maps to a finding above
npx tsx --test server/webhookState.team.test.ts  # existing suite, unaffected
```

The tests assert **current (buggy) behaviour** on purpose; when the fixes land,
flip the relevant assertions to lock in the corrected behaviour.
