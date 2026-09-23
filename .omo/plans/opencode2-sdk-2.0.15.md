# OpenCode2 2.0.15 adaptation

## Goal and stop condition

Adapt the source-checkout OpenCode2 plugin to exact SDK/host 2.0.15. Stop only
after real isolated host evidence, unit/type/build gates, independent review,
and a merge-commit PR to dev. Native BTW is the preferred user interface; inspect
its contract before deciding whether the optional legacy tools need retirement.

## Scope and verification

One cohesive API-compatibility PR, based on dev 598cb6658. The SDK pin and API
calls must land together. A read-only parallel reviewer maps the SDK differences;
implementation and live QA are sequential in this task-owned worktree.

1. Capture baseline activation failure on the real 2.0.15 binary with the existing
   isolated qa-api-upgrade driver. Record sandbox cleanup and real-host hashes.
2. Update packages/omo-opencode2/package.json exact plugin/schema pins and bun.lock;
   retain Effect's matching peer. Verify install and package typecheck.
3. Adapt src/native-registrations.ts and src/agents/model-resolution.ts from the
   removed catalog domain to the new model domain. Update model-resolution.test.ts
   and register.test.ts fixtures; prove default model and refreshed vision inventory.
4. Map additional typed/runtime differences before editing affected files. Extend
   this plan and checklist when evidence identifies another broken contract.
5. Update scripts/qa-native-team.mjs and qa-workflow-team.mjs version assertions;
   adapt command/protocol fixture fields only against the actual 2.0.15 contract.
   Run qa-api-upgrade.mjs --installer, qa-native-team.mjs and qa-workflow-team.mjs
   with local mock model, isolated HOME/XDG stores, explicit binary path and traces.
6. Verify native BTW coexistence or retirement against the actual 2.0.15 TUI/API
   boundary. Record a bounded isolated TUI smoke for `/btw`; do not claim a
   model-generated answer when the fake provider cannot answer. Keep this separate
   from the retired plugin implementation.
7. Update packages/omo-opencode2/AGENTS.md and .agents/skills/opencode2-qa/SKILL.md
   to describe the exact target and corrected API boundaries. Review prose by read.
8. Run bun test packages/omo-opencode2/src, bun run typecheck, bun test and
   bun run build. Store complete logs and sanitized live receipts under
   .omo/evidence/20260923-opencode2-sdk-2.0.15/.
9. Independent read-only review; fix findings with fresh scoped QA, commit atomic
   units with evidence, create English PR, wait for CI/Cubic, merge using --merge.
10. Preserve task state/evidence, sync dev and remove the task-owned worktree.

## Binding success criteria

- C001: 2.0.15 loads OMO and registers expected agents/tools/commands; enabled and
  disabled paths and contradictory original OMO settings are observed on the wire.
- C002: Task, Team, Workflow, cancellation, notifications and restart reconciliation
  pass real-host drivers; native BTW is covered at its actual API boundary.
- C003: Unit/type/build gates and independent review pass; host stores/configs are
  unchanged; captured evidence is included in a merged PR.

## Todo ledger

- [x] Inspect current production entry, configuration, QA drivers and existing evidence.
- [x] Create isolated task-owned worktree and move this session into it.
- [ ] IN PROGRESS: audit exact SDK diff and capture baseline host failure.
- [ ] Register evidence-bound loop goal with available local CLI.
- [ ] Change dependency pins and verify reproducible install.
- [ ] Adapt model registry and tests, verify model/vision/default behavior.
- [ ] Address further API differences discovered by audit/typecheck/live QA.
- [ ] Confirm native BTW contract and implement the bounded integration decision.
- [ ] Update all three live drivers to target 2.0.15; prove positive/negative paths.
- [ ] Update adapter and QA documentation; review for stale claims.
- [ ] Pass scoped tests, root typecheck, root tests and build; save logs.
- [ ] Obtain independent review and resolve each actionable finding.
- [ ] Commit verified atomic units with sanitized complete evidence.
- [ ] Open PR, pass CI and Cubic gate, merge via merge commit.
- [ ] Sync main checkout/task state and clean up worktree.
