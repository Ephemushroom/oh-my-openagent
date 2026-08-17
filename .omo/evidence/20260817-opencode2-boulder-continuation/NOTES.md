# Boulder (start-work) continuation enforcer, QA evidence

Change: `packages/omo-opencode2` gains a third idle injector, the boulder
(start-work) continuation. On idle, if the session owns an active plan in
`.omo/boulder.json` with unchecked top-level tasks, it injects a prompt listing
the next task and nudging the model to continue the plan. It is a third
configuration of `orchestration/idle-injector.ts` and shares the ONE gate
instance with goal and the todo enforcer.

Harness: `qa.sh` in this directory. Real `opencode2` binary
(`0.0.0-next-17444`), isolated sandbox, live `zhipuai/glm-4.7`. The boulder
state is seeded by calling the real `@oh-my-opencode/boulder-state` writer from
bun, so the file is byte-for-byte what the reader consumes; the session id is
learned by a probe run first (the context hook records it on
`omo.context.agents`), then the work is seeded bound to that id and the
follow-up turn in the same project goes idle with the work owned.

## What was tested

**RUN A, boulder ON, goal + todo OFF, seeded work.** A session whose
`.omo/boulder.json` names it as owning an active plan with 2 of 3 tasks
remaining is told to stop. On the idle edge the enforcer must inject. This
proves the whole file pipeline end to end: read boulder.json -> resolve the
plan path -> parse the checklist -> inject. RUN A is the positive direction;
without it RUN B's "not both" would pass vacuously.

**RUN B, boulder + goal + todo all ON, seeded work.** Three independent idle
injectors now observe the same idle edge.

## What was observed

`summary: PASS=8 FAIL=0`

| Check | Observed |
|---|---|
| a-plugin-loaded | trace non-empty, 156 lines |
| a-registered | `omo.boulder.registered` x1 |
| a-enforcer-fires | `omo.boulder.continuation-injected=1`, `event-error=0` |
| b-plugin-loaded | trace non-empty, 105 lines |
| b-all-armed | `goal=1 todo=1 boulder=1` registered |
| b-single-dispatch | `goal=0 todo=0 boulder=1` **sum=1** |
| b-no-pump-error | `event-error=0` on all three |
| isolation | host `opencode.db` unchanged (absent to absent) |

The load-bearing numbers are RUN A's `boulder-injected=1` (the file pipeline
really drives an injection, so this is not dead code) and RUN B's **sum=1**
(three injectors on one live idle edge, exactly one injection between them;
here boulder won the edge and goal and the enforcer were correctly blocked).

Artifacts: `out/run-boulder-only.txt`, `out/run-all.txt`, `out/probe-*.txt`
(session-id probes), `out/boulder-events-a.ndjson`,
`out/boulder-events-b.ndjson` (filtered `omo.*` trace events),
`out/trace-tail.ndjson` (last 40 lines of RUN B).

## Why it is enough

This is the first time three real features contend on one live idle edge, which
is the contention the shared gate exists to bound. The unit suite covers what
the binary cannot cheaply reach: the exact-match resume path
(`boundVia="session"`), the sole-active fallback, the non-continuable-status
and fully-checked-plan cases returning null, and the gate both-directions
property already pinned in `idle-injector.test.ts`. `bun test
packages/omo-opencode2/src` is 222 pass / 0 fail, `bun run typecheck` exits 0.

## A design flaw found and fixed before this QA

The first cut resolved strictly via `getWorkForSession`, which requires the
work's `session_ids` to contain the exact session id. Nothing in v2 binds that
id before the first turn, so the feature would have been dead code in
production: every resolve returned null. The fix is the `boundVia` resolution
in `state.ts`: exact-match when the id is recorded (a resumed session), and
when the file holds exactly one active work, that single work is treated as the
session's plan (v2's single-active-work mirror mode). The multi-work /
explicit-resume path is v1-only and out of scope; the "ambiguous which work"
case returns null and is a follow-up.

## Residual risk

The ambiguous case (more than one active work, session not recorded in any)
returns null, so the enforcer does nothing rather than guess. That is the safe
direction; a v1-style explicit resume surface would resolve it. The plan-file
association depends on the start-work flow having written a real
`.omo/boulder.json`; a session that starts a plan without boulder state is
untouched, which is correct.

## What was omitted

No raw full traces and no model catalog dumps are committed (they carry
provider model ids the repo-wide legacy-model audit scans for). Only filtered
`omo.*` event files, a 40-line tail, and the CLI output are kept. No
credentials appear in any artifact.
