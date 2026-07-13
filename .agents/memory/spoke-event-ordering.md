---
name: Spoke webhook/data-action ordering
description: Spoke Phone event ordering quirks around queue rollover and how the wallboard must interpret them
---

# Spoke event ordering around queue rollover

- On queue timeout + rollover, Spoke sends `call.not_answered` (previous team's timeout) milliseconds BEFORE the next team's Team Call data action. The call is NOT actually over — treat a data action naming a DIFFERENT team, arriving shortly (≤2 min) after a premature end, as proof the call is still live and revive it. A data action for the SAME team or arriving late is a replay and must never resurrect a finished call.
- The payload's top-level `waitTime` on `call.answered`/`call.ended` measures from the INITIAL ring, not the current team's ring. For rolled-over calls (`viaTeams` non-empty), compute the answering team's wait from its team-local ring start instead.
- A team that missed a rolled-over call should still get the ring time credited into its avg wait stats (user requirement).
- `call.not_answered` can also arrive out of order naming an earlier team after the call already rolled on — credit the miss only to a team that provably owned the call leg, and keep the call ringing for its current team.

**Why:** ABC Heating production incident (Sales → Toyota Parts rollover) produced three visible bugs: no ringing on the new team, inflated wait time, and the call showing active in both teams.

**How to apply:** Any logic touching rollover, revive, or wait-time attribution in the webhook/data-action handlers must respect these ordering rules; tests live in the team state test file.
