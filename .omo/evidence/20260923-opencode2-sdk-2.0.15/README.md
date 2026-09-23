# OpenCode2 SDK 2.0.15 adaptation

## WHAT WAS TESTED

- Compared the installed `@opencode/plugin` and `@opencode/schema` 2.0.3 and
  2.0.15 type surfaces. The adapter was updated from the removed `ctx.catalog`
  domain to `ctx.model.transform`, with `ModelEditor.default` and `Skill.Info.path`
  semantics.
- Ran the scoped package gate: `bun test packages/omo-opencode2/src` and
  `bunx tsgo --noEmit -p packages/omo-opencode2/tsconfig.json`.
- Ran the real OpenCode host `/opt/homebrew/bin/opencode` at version 2.0.15 in
  isolated XDG/HOME sandboxes with a loopback mock model:
  - `qa-api-upgrade.mjs ... --installer`: 35 assertions, zero failures.
  - `qa-native-team.mjs`: 11 real Team/background/monitor assertions, zero failures.
  - `qa-workflow-team.mjs`: 10 workflow lifecycle/restart/cancellation assertions,
    zero failures.
- Ran an isolated tmux TUI smoke on real OpenCode 2.0.15, booted `opencode mini`,
  accepted `/btw ...` input, and cleaned the TUI process. Artifacts:
  `native-btw-tui-2/receipt.txt` and `native-btw-tui-2/tmux-final.log`. The host's
  current V2 docs identify `/btw` as the native side-question entrypoint:
  `https://opencode.ai/v2/docs/cli/tui/`. The adapter no longer registers the
  redundant `btw_*` tool family or its custom Executor owner/configuration.
- Ran root `bun run typecheck` and `bun run build` successfully. Root `bun test`
  completed with 18,698 passes and 1 unrelated existing failure in
  `script/build-omo-binary.test.ts` (`plugin/skills/ast-grep/SKILL.md` sidecar
  parity), plus 40 existing skips.

## WHAT WAS OBSERVED

- The pre-change 2.0.15 baseline failed at runtime with:
  `undefined is not an object (evaluating 'ctx.catalog.transform')`.
  Artifact: `baseline-2.0.15/`.
- The fixed API run emitted `omo.registration.complete`, registered the expected
  agents and tools, passed enabled/disabled feature checks, and preserved the
  contradictory original OMO configuration files.
  Artifacts: `green-api-3/receipt.json`, `green-api-3/enabled.ndjson`,
  `green-api-3/disabled.ndjson`.
- Team QA passed member creation/follow-up, durable task/status state, ownership
  checks, background notification delivery, monitor permissions/output, model and
  Team capacity limits, and forced deletion drain behavior.
  Artifact: `native-team-2/receipt.json`.
- Workflow QA passed dependency-frontier progress, idempotent starts and retries,
  generation checks, cancellation drain, restart reconciliation, and explicit
  retry after shutdown.
  Artifact: `workflow-team-2/receipt.json`.
- All live drivers reported unchanged real host state and cleaned owned processes.
  The captured receipts contain no credentials or authorization headers.

## WHY IT IS ENOUGH

The package gate proves the adapter and its unit contracts compile and pass. The
isolated 2.0.15 runs prove the plugin actually loads in the target host and exercise
the production registration, command, tool, orchestration, Team, monitor, storage,
restart, and configuration-isolation paths. The API-driver updates also cover the
2.0.15 host route changes for command names, deep-object location queries, context
history, and experimental session wait.

## LIVE VERSUS UNIT PROOF

The real host receipts prove plugin activation and runtime behavior. Unit tests cover
the pure model snapshot, skill path, executor, workflow, and dispatch contracts that
are not all deterministic to force through one model turn.

## WHAT WAS OMITTED

- No real provider credentials or network model calls were used; all model traffic
  used the local mock server.
- The TUI smoke did not assert a model-generated BTW answer because the isolated
  run intentionally used a loopback-unavailable fake provider. The real-host API
  receipts prove the adapter does not advertise duplicate BTW tools; native BTW
  answer semantics remain host-owned.
- The single root test failure is outside `packages/omo-opencode2` and reproduces
  the existing sidecar fixture mismatch; it was not bypassed or weakened.
