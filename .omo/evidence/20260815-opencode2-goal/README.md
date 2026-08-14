# OpenCode2 Goal QA Evidence

Date: 2026-08-15 | Branch: `feat/oc2-goal` | Target: `dev`

## WHAT WAS TESTED

The v1 persistent per-session goal feature was ported to the OpenCode2 adapter:

- `create_goal`, `get_goal`, and `update_goal` use the calling session only.
- Goal state is stored as versioned JSON under `.omo/goal/` with atomic writes.
- `active`, `paused`, and `complete` transitions retain v1 timestamps and metrics.
- Active goals inject a continuation after an idle execution edge.
- Concurrent and repeated idle edges collapse to one dispatch reservation.
- Session deletion removes persisted state and in-memory reservations.
- Registration is off when `[opencode2].goal.enabled` is omitted.
- `goal.auto_start` creates one goal from the first real main-session user
  message, while child sessions and later user turns remain unchanged.

Verification:

- TDD RED: `out/tdd-red.txt` records the initial missing-module failure, and
  `out/review-red-auto-start.txt` records the review-discovered auto-start gap.
- Focused goal suite: `21 pass`, `0 fail`, `46 expect()` calls.
- Full OpenCode2 adapter suite: `144 pass`, `0 fail`, `397 expect()` calls.
- Full workspace typecheck: `bun run typecheck` exited `0`.
- Strict TypeScript audit: no violations across the 16 goal files.
- Real surface: `qa.sh` drove pinned `opencode2 v0.0.0-next-17055` with
  `zhipuai/glm-4.7` in isolated XDG, HOME, and USERPROFILE directories.
- Gate details and Windows-only unavailable checks are recorded in
  `out/final-gates.txt`.

## WHAT WAS OBSERVED

`out/qa-summary.txt` ends with `summary: PASS=17 FAIL=0`.

- Default-off fixture: `omo.goal.disabled` appeared and
  `omo.goal.registered` was absent when goal configuration was omitted.
- Enabled fixture: `omo.goal.registered` listed all three tools.
- Auto-start disabled fixture: `omo.goal.auto-start-registered` was absent.
- Auto-start enabled fixture: `omo.goal.auto-start-registered` and
  `omo.goal.auto-started` each appeared once; the first message marker persisted
  and the model completed that goal.
- Real tool calls: `omo.goal.created` and `omo.goal.completed` appeared after
  the model called `create_goal`, `get_goal`, and `update_goal`.
- Persistence: `out/persisted-goal-check.txt` confirms the versioned file
  retained `GOAL_QA_TOOL_MARKER` with status `complete`.
- Lifecycle: an active goal followed by `session.execution.succeeded` produced
  exactly one asserted `omo.goal.continuation-injected` event.
- Isolation: `out/isolation-violations.txt` is empty.

## WHY IT IS ENOUGH

The unit tests isolate persistence, transition, session isolation, prompt
escaping, config gating, first-turn and main-session filtering, auto-start race
collapse, deletion cleanup, active-state rechecks, busy-session cancellation,
and duplicate idle dispatch. The real-binary run then proves the
OpenCode2 SDK accepts the tool definitions, loads project config, executes the
tools, writes project state, receives lifecycle events, and submits a synthetic
continuation through the actual plugin surface.

Both feature and auto-start config directions are first-class checks. A feature
that always registers would fail the omitted-config fixture, while an auto-start
hook that ignores its flag would fail the enabled-without-auto-start fixture.

## LIVE VERSUS UNIT PROOF

- Live proof covers registration, all three tool calls, configured auto-start,
  persisted complete state, a real execution-success edge, continuation
  injection, and isolation.
- Unit proof covers deterministic concurrency races that are unsafe to induce
  through a live model: simultaneous idle edges, repeated idle edges inside the
  hold window, a session becoming busy during settle, and a goal being paused
  during settle. It also covers child-session and concurrent auto-start edges.

## WHAT WAS OMITTED

- The live CLI is not required to finish the synthetic resumed model turn.
  `opencode2 run` exits while that second execution is starting, so the live
  lifecycle assertion stops at the plugin-owned continuation injection. Goal
  completion is proven separately by a live direct tool call.
- Root `bun test` was attempted but is not a valid green gate on this Windows
  checkout: unrelated suites require Unix `chmod`, generated Codex/Senpi
  artifacts, and longer process-cleanup windows. The affected OpenCode2 suite
  passes in full, and CI on Linux remains the repository-wide test authority.
- Root `bun run build` reached the vendored LSP MCP build and failed because its
  npm script invokes Unix `rm` through Windows `cmd.exe`. No build output or
  generated schema change is included in this branch.
- V1 usage accounting is not ported, so `tokensUsed` and `timeUsedSeconds`
  remain zero. The v2 `update_goal` tool is status-only; objective replacement
  continues to use `create_goal`.
- The ZhipuAI key was read from the existing auth store into the isolated child
  environment only. It was never printed, copied, or committed.
- Raw environment dumps, authentication headers, tokens, and private
  credentials were not captured.
