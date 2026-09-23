---
name: opencode2-qa
description: "QA the OpenCode2 v2-API adapter (packages/omo-opencode2) against the real pinned opencode2 binary in a fully isolated sandbox, proving a capability fired via OMO_SPIKE_TRACE NDJSON rather than CLI prose. Covers the isolation sandbox, plugin wiring from TS source, trace assertion helpers, the both-directions rule, host-store isolation sweeps, and the evidence bundle layout required before commit. Use whenever someone changes anything under packages/omo-opencode2 or wants to QA, smoke-test, verify, or debug the v2 adapter, its hooks, tools, agents, or orchestration. Triggers: opencode2 qa, qa opencode2, oc2 qa, verify opencode2 hook, test v2 adapter, omo-opencode2 qa, prove opencode2 trace event."
---

# OpenCode2 QA

QA the v2-API adapter at `packages/omo-opencode2/`. This is the sibling of
`opencode-qa` (v1) and `codex-qa` (Light edition), and it exists because v2's
plugin API is different enough that the v1 regimen does not transfer.

The core difference: **v1 QA proves a hook fired via the SSE event stream. v2 QA
proves it via `OMO_SPIKE_TRACE` NDJSON**, because the v2 adapter emits its own
trace events and the CLI does not expose raw system parts or tool results.

Target the exact SDK version in `packages/omo-opencode2/package.json` and record
the real host's `--version`. Current target: OpenCode 2.0.15 (`@opencode/cli@2.0.15`
matching `@opencode/plugin@2.0.15` and `@opencode/schema@2.0.15` with
`effect@4.0.0-rc.112`). The production entry is native Effect via
`@opencode/plugin/effect`. The host's `/btw` side-question flow is native TUI
behavior and is not an OMO plugin tool; QA must not reintroduce or assert a
duplicate `btw_*` tool surface.

## Golden rules

- **Assert on the trace, never the CLI transcript.** `opencode2 run` prints
  human summaries (e.g. `Read <file>`), not raw tool results or injected system
  parts. An assertion that greps the transcript is testing the renderer.
- **Assert BOTH directions, always.** A hook that always fires passes any
  presence-only test. Every capability needs a positive case AND a negative case
  (feature disabled, or input that must not trigger it).
- **Read the v1 source before asserting its behavior.** Port QA has repeatedly
  failed because the assertion encoded a plausible misreading of the v1 rule
  rather than the rule. See "Contract accuracy" below.
- **Anything that spawns the binary runs in a throwaway sandbox.** Never let QA
  touch the real `~/.local/share/opencode`, `~/.config/opencode`, or
  `~/.cache/opencode`.
- **No evidence bundle on disk means the QA did not happen.** No commit, no push.

## Working references

Three proven `qa.sh` files are committed as immutable evidence. Copy the closest
one rather than writing a harness from scratch:

| Scenario | Reference |
|---|---|
| `tool.execute.before` guards, both directions | `.omo/evidence/20260814-opencode2-tool-guards/qa.sh` |
| context/system-part injection, present vs absent | `.omo/evidence/20260814-opencode2-rules-injector/qa.sh` |
| task orchestration / delegation | `.omo/evidence/20260814-opencode2-delegate-retry/qa.sh` |

## Harness anatomy

**1. Isolation sandbox.** `mktemp -d`, then point every store at it:

```bash
export XDG_DATA_HOME="$SANDBOX/data"   XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"            USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
```

`USERPROFILE` is mandatory on Windows: without it the binary resolves the real
home and the isolation sweep fails.

**2. Model boundary.** Prefer the loopback Responses mock in
`packages/omo-opencode2/scripts/qa-api-upgrade.mjs`; it uses no user credentials.
For an explicitly required real-provider check, pass credentials through the
child environment only. Never print, copy, or commit them:

```bash
ZHIPU_API_KEY="$(node -e '...' "$REAL_HOME/.local/share/opencode/auth.json")"
export ZHIPU_API_KEY
```

**3. Plugin wiring.** opencode2 imports the adapter as TypeScript source. Write
an `opencode.jsonc` into the sandbox project pointing at the real entry DIRECTORY
(`cygpath -m` on Windows, and escape backslashes for JSON):

```jsonc
{ "model": "zhipuai/glm-4.7", "plugins": ["<abs path>/packages/omo-opencode2/src"] }
```

OMO settings are separate from that host config: write `<sandbox-home>/.omo/opencode2.json`
with adapter settings at its root, or `<project>/.omo/opencode2.json` for project
overrides (`.jsonc` fallback). Seed conflicting `omo.json[c]` in isolation tests to
prove v1 settings are ignored, and verify their bytes are unchanged. Include real
`~/.omo/opencode2.json` and `.jsonc` in the before/after host-state hash comparison.

**4. Trace.** Set `OMO_SPIKE_TRACE` to a per-case file, truncate it, run the
case, then copy it into `out/`. Drive the binary with
`opencode2 run --standalone --auto --print-logs`, under `timeout -k 5 300`.
`--print-logs` is required to capture the standalone server's diagnostics.
Exit zero alone does not prove OMO loaded: a rejected or disabled plugin can
leave the native CLI working without any OMO tools.

**5. Assertions.** Use the `trace_has` / `trace_absent` node heredocs from any
reference `qa.sh`. They parse the NDJSON, count matching events, write a JSON
result into `out/`, and exit non-zero on failure so `check` can tally PASS/FAIL.

**6. Host-store isolation sweep.** `touch` a marker before the run, then
`find` the real stores for files newer than it. Documented exclusions, each for
a stated reason, not for convenience:

- `opencode.db*`, `*.log`, `*.lock`, `*/shell/*`, `*/snapshot/*`, `*/storage/*`
- `models.json`: opencode2 refreshes its global provider catalog regardless of
  `XDG_CACHE_HOME` and `OPENCODE_DISABLE_MODELS_FETCH`. No session or project
  state, and the plugin never writes it.
- `*/tool-output/*`: parent-harness scratch, written by the agent driving QA,
  not by the isolated child.

## Native execution runtime QA boundaries

The native Effect runtime introduces unified execution handling via `Executor`. Assert against these concrete runtime contracts:

- **Queued acceptance vs child completion.** Background task calls must return accepted `TaskID` and generation references before child execution finishes. Held mock models prove the caller receives an immediate reference while admission permits stay held until settlement.
- **Synchronous admission budgets.** Model limit (5), team limit (4), and session limit (1) reserve together in a single synchronous decision. Test that cancelling queued work frees the reservation without ever spawning child sessions.
- **LockPath crash fail-closed behavior.** The writer creates `.omo/execution/${locationKey}.lock` with non-recursive directory creation. A crashed process that leaves the lock behind must cause subsequent startup to fail closed with conflict, requiring explicit manual recovery.
- **Storage records and restart reconciliation.** Execution records persist under `execution/${locationKey}/${taskID}/${generation}` in plugin storage. Restart maintains queryable terminal records, while unfinished runs drain and reconcile to `interrupted` status, never automatically replaying prompts.
- **Per-item notifications vs root observer gate.** Background completions persist in `notifications/${locationKey}/` and dispatch via outbox queue. These per-item notifications are distinct from `session-dispatch-gate.ts`, which only coordinates competing observers on a single idle or error edge.
- **Workflow tool actions.** Drive acyclic graphs through `workflow` (`start`, `snapshot`, `wait`, `cancel`, `retry`). Assert that `dependsOn` enforces order only, independent branches continue past failed siblings, and retry preserves completed nodes.
- **Team Mode boundary.** Run `packages/omo-opencode2/scripts/qa-native-team.mjs` with a fresh evidence directory. Its held-response scenario must prove four Team executions leave the fifth model slot available to ordinary work, and forced deletion closes every member's admission before released capacity can start queued members.
- **Workflow lifecycle.** Run `packages/omo-opencode2/scripts/qa-workflow-team.mjs` with a fresh evidence directory. It exercises generation/key-aware retries, preserved successful nodes, frontier progress, batch cancellation, active host shutdown and explicit retry after restart. This complements, not replaces, the original 33-check `qa-api-upgrade.mjs --installer` baseline.

## Contract accuracy

Three real assertion defects found in this port. Check for all three:

- **Asserting a contract the code never made.** The write guard rejects the
  *write* and redirects to edit; it does not freeze the file. Read-then-edit is
  the intended recovery, so "file unchanged" is wrong. Assert the rejection
  message reached the model.
- **Asserting against the transcript.** A hashline tag assertion grepped the CLI
  output, which prints a `Read <file>` summary rather than tagged content. Assert
  the trace event, plus the model's own citation of a `LINE#ID` tag.
- **Encoding a misread rule.** `prometheus-md-only` is not "prometheus may write
  markdown". v1's `path-policy.ts` requires **both** an `.omo` path segment and an
  allowed extension, so only `.omo/**/*.md`. `plan.md` blocked and `.omo/plan.md`
  allowed is what discriminates the real rule from the plausible one.

## Model temperament is not adapter behavior

Some branches cannot be driven live, and forcing them is a trap:

- A genuinely **empty** model response cannot be summoned on demand.
- **Prometheus refuses non-markdown writes outright** and enters interview mode,
  so the guard never sees the write and has nothing to block.
- The model generally **will not write slop comments** when the system prompt
  discourages them.

Do not retry until the model cooperates; that tests temperament. Prove the
branch by unit test, prove the negative direction live, and write an explicit
`LIVE VERSUS UNIT PROOF` section. Never fabricate a live pass.

## Evidence bundle

Write to `.omo/evidence/<YYYYMMDD>-opencode2-<slug>/` with `qa.sh`, an `out/`
directory of captured artifacts, and a `README.md` covering:

**WHAT WAS TESTED** / **WHAT WAS OBSERVED** / **WHY IT IS ENOUGH** /
**LIVE VERSUS UNIT PROOF** / **WHAT WAS OMITTED**

`.omo/` is gitignored. You **must** `git add -f .omo/evidence/<dir>` and then
confirm with `git status` / `git show --stat` that the **whole** directory
including `out/` is tracked. A prior agent committed only `README.md` and
`qa.sh` and silently dropped every proof artifact.

Scan the bundle for secrets before committing.

## Repo traps

- `bun install` **fails** here: the `prepare` script runs
  `git submodule update --init --recursive` on `packages/shared-skills/upstreams/*`,
  which is broken locally. Use `bun install --ignore-scripts`.
- Never create a flat `foo.ts` beside an existing `foo/` directory module. Node
  resolves the file first and silently shadows the directory; this shipped a
  crash in the `edit` tool once already.
- `packages/omo-opencode/src/cli/doctor/spawn-with-timeout.test.ts` fails on
  Windows on clean `dev` and passes in CI. Not yours; do not fix.
- `acquireSessionAdmissionLease` in `packages/senpi-task` is a known racing-CAS
  flake in CI. Re-run, do not fix.
- Gates before commit: `bun test packages/omo-opencode2/src` (0 fail) and
  `bun run typecheck` (exit 0).
