# OpenCode2 Team Mode QA Evidence

Date: 2026-08-23 | Branch: `feat/oc2-team-mode` | Base: `origin/dev`

## WHAT WAS TESTED

- Automated adapter gate: `bun test packages/omo-opencode2/src`.
- Repository type gate: `bun run typecheck`.
- Positive live surface: an isolated real `opencode2` session enabled
  `[opencode2].team_mode.enabled`, created a two-worker team, sent a direct
  message, read team status, and deleted the run.
- Negative live surface: an isolated default configuration loaded the plugin
  without enabling Team Mode.
- Isolation: host `session_v2` row count was captured before and after both live
  runs.

## WHAT WAS OBSERVED

- `qa.sh` finished with `PASS=13 FAIL=0` against `opencode2
  v0.0.0-beta-17941` and `zhipuai/glm-4.7`.
- The adapter gate reported `341 pass, 0 fail`, `777 expect()` calls across 59
  files. It emitted one non-failing Windows `EBUSY` temp-directory cleanup
  warning from the pre-existing session-store test.
- Repository typecheck exited 0 across the root, script, and package configs.
- The TypeScript no-excuse audit reported no violations in 20 changed files;
  all new Team Mode files are at or below 200 total lines. The local TypeScript
  LSP is not installed and its prior install decision is recorded as declined,
  so no host configuration was changed.
- Positive trace analysis reports all 12 tools registered, `qa-team` created,
  2 member sessions started, direct message send and queued delivery observed,
  status read with 3 total participants, and deletion completed.
- The project registry artifact existed at
  `.omo/teams/qa-team/config.json` inside the sandbox.
- Negative trace analysis reports `disabled=true` and `registered=false`.
- Host `session_v2` count remained `1135` before and after live QA.

## WHY IT IS ENOUGH

The unit suite covers team-core registry/mailbox/task transitions, registration
gating, bounds, spawn agent selection, direct delivery, and shared-gate idle
wake behavior. The live positive case proves the real v2 harness registers and
drives the tools and member sessions; the negative case prevents an always-on
registration from passing. Host count comparison proves session persistence
stayed in the sandbox.

## LIVE VERSUS UNIT PROOF

- **Live:** tool registration, team creation, real member session start, queued
  lead-to-member message flow, status read, deletion, project team spec storage,
  default-off behavior, and host session count isolation.
- **Unit:** deterministic mailbox poll/ack, concurrent idle-wake collapse,
  task claim/update transitions, malformed config rejection, and max-member
  bounds.

## WHAT WAS OMITTED

- Tmux layout and per-member git worktrees are intentionally outside v1 of this
  port and are documented follow-ups.
- The ZhipuAI credential is read into the isolated child environment only. It is
  never printed or copied into evidence.
- Raw environment dumps, auth headers, tokens, and provider payloads are not
  retained.
