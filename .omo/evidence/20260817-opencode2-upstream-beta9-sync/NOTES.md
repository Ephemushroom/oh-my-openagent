# Upstream beta.9 sync, QA evidence

Change: full `git merge upstream/dev` into the fork's dev (1009 commits,
merge-base `ea2b387` to `v5.0.0-beta.9`). Not a cherry-pick.

Harness: `qa.sh` in this directory. Real `opencode2` binary
(`0.0.0-next-17444`), isolated sandbox, live `zhipuai/glm-4.7`.

## What was tested

The merge touches packages the opencode2 adapter consumes (model-core,
shared-skills, agents-core, prompts-core, boulder-state), so the QA proves the
adapter still boots and runs after the merge, and that the fork's own surface
on top of those packages survived: the shared dispatch gate and its three idle
injectors (goal, todo, boulder), all armed at once.

## What was observed

`summary: PASS=6 FAIL=0`

| Check | Observed |
|---|---|
| plugin-loaded | trace non-empty after merge (149-159 lines across runs) |
| surface-registered | `omo.orchestration.registered`, `omo.tool-guards.registered`, `omo.context-hooks.registered` each x1 |
| gate-injectors-armed | `omo.goal.registered=1`, `omo.todo.registered=1`, `omo.boulder.registered=1` |
| session-completed | `session.execution.succeeded=1`, `session.execution.failed=0` |
| no-pump-error | `event-error` count=0 on all injectors |
| isolation | host `opencode.db` unchanged (absent to absent) |

Artifacts: `out/run.txt` (CLI output), `out/trace-tail.ndjson` (last 30 trace
lines showing the full execution lifecycle: reasoning -> text -> step.ended ->
execution.succeeded).

## Why it is enough

The merge is content, not wiring: it changes package internals the adapter
imports but does not touch the adapter's own source (`packages/omo-opencode2`
is fork-only; upstream has no conflicting side). The risk is therefore that an
upstream change underneath the adapter breaks its assumptions (a renamed
detector, a moved prompt, a changed skill format). Booting the real binary and
driving a real session exercises exactly those import and registration paths:
agent resolution reads model-core, the sisyphus prompt comes from agents-core,
and the skill catalog registers shared-skills including the new ulw-plan
content.

Unit gates: `bun test packages/model-core packages/omo-opencode2/src
packages/agents-core` is 599 pass / 0 fail, `bun run typecheck` exit 0.

## Conflict resolutions a reviewer should spot-check

- CI kept slimmed; the four upstream CI-topology test files that assert jobs
  the fork deleted were re-trimmed (`ci-fast-path`, `ci-root-test-partition`,
  `root-test-config`, `remove-stale-self-package-tests`).
- `AGENTS.md` kept ours; it carries the opencode2 QA contract.
- `package.json`: upstream's version bump + senpi 2026.8.17 + `test:fast`,
  plus the fork's `agents-core` / `omo-opencode2` workspace and typecheck
  entries.
- The Grok 4 Sisyphus prompt was ported into `agents-core/sisyphus/grok-4.ts`
  (where the fork's Phase 1 extraction moved prompt bodies); the v1-side file
  stays a re-export shim like its siblings.
- Stale generated artifacts regenerated: `assets/omo.schema.json` and the
  Codex installer bundle (was stamped beta.8; root is now beta.9).
- `agent-command-string-audit.allowlist.json`: upstream's line-number-free
  format minus four entries for files the fork does not carry.

## Residual risk

Three root-suite tests fail locally on Windows but are absent from dev's
baseline and skip or pass where their prerequisites exist (a built `dist`, a
python interpreter, a real senpi RPC child): `verify-omo-ai-payload`,
`mass-ulw skill-contract`, `task-rpc-e2e.windows`. CI satisfies all three. The
pre-existing `DMCA provenance gate` failure depends on submodule checkout state
and predates this change.

## What was omitted

No raw full traces and no credentials in any artifact; the API key is read
from the host auth store into the child environment and never written to disk.
