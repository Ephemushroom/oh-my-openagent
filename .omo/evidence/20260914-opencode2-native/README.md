# OpenCode2 2.0.3 native Effect migration

Implementation snapshot: `9cce95434` (37 module-level source commits after
`1ef657b2f`). Native SDK/schema 2.0.3, Effect 4.0.0-rc.112. The v1 SDK retains
its separate Effect beta.83 dependency. This is a source-checkout adapter, not
a runtime package publication.

## What was tested and observed

| Surface | Command or action | Result | Captured evidence |
| --- | --- | --- | --- |
| Production entry and installer | `node packages/omo-opencode2/scripts/qa-api-upgrade.mjs NEW_DIR --installer` | 33/33 pass on actual 2.0.3 | [baseline receipt](production-workflow-schema/receipt.json) |
| Native Executor fixture | `node packages/omo-opencode2/scripts/qa-execution.mjs NEW_DIR` | 5/5 pass; dedicated fixture, not production parity | [executor receipt](executor-production-gate/receipt.json) |
| Full Team, BTW, monitor, root/managed notifications, shared quotas | `node packages/omo-opencode2/scripts/qa-native-team.mjs NEW_DIR` | 12/12 pass | [production receipt](managed-notification-production/receipt.json) |
| Workflow graph, frontier, retry, cancellation and active shutdown/restart | `node packages/omo-opencode2/scripts/qa-workflow-team.mjs NEW_DIR` | 10/10 pass | [workflow receipt](workflow-production-active-restart/receipt.json) |
| Root tests | `bun test --timeout 20000` | 18,710 pass; 40 pre-existing skips; zero failures | [test log](root-tests-reviewed.log) |
| Root/script/package typecheck | `bun run typecheck` | exit 0 | [typecheck log](typecheck-gate.log) |
| Changed test and QA-fixture typing | strict explicit `tsgo --ignoreConfig --noEmit`, including the prompts-core Markdown declaration and native QA plugin | exit 0 | [typing summary](test-types-summary.txt) |
| Build | `bun run build` | all build steps completed, exit 0 | [build summary](build-summary.txt) |
| V1 audit-only compatibility | isolated v1 1.18.22 server smoke | health, 162 API paths and auth denial pass; real session count unchanged | [smoke](v1-audit/smoke.log), [isolation](v1-audit/isolation.txt) |
| Independent gate review | source review plus managed-recipient regression and live proof | APPROVE on re-review | [initial review](review-1.md), [final review](review-2.md) |

Each live receipt directory includes its exact API/model/trace or process output,
not just a pass summary. QA used isolated HOME/USERPROFILE/XDG stores and local
mock providers. Receipts capture host-state comparisons and owned-process cleanup.

## Why this covers the migration

The baseline exercises the actual source-directory plugin entry, not a replacement
test plugin. The extended production driver proves caller isolation, retained
member turns, shutdown fences, a real monitor process, and four held Team members
coexisting with an ordinary task in the fifth model slot. Forced deletion never
starts the queued fifth Team member.

Managed-recipient completion is proven twice: a real Executor+Outbox+Delivery
regression holds the parent while child completion and parent generation-2 queueing
finish, and the real host runs a managed task that receives its background child's
completion in one additional admitted turn. Enqueue only offers a durable outbox
key; dispatch occurs in another scoped worker, avoiding mutex reentrancy.

Workflow proof covers invalid graphs/targets before any launch, dependency-frontier
progress without a wave barrier, key/generation-aware retry preserving successful
nodes, cancellation of five held nodes plus a queued node, active host shutdown,
queryable history after restart and explicit retry. Authored node prompts remain
unchanged; dependencies do not implicitly inject upstream output.

## Failures found and resolved

- Notification failures and defects must not hang execution waiters or kill the
  remaining outbox queue. Typed-failure and defect regressions are retained.
- Recovery must scan all notification pages and select numeric generations,
  not lexicographic storage order.
- Foreground timeout/interruption must cancel and drain the shared execution.
- Team deletion must close every member's admission before releasing active slots.
- QA must wait for admitted member execution, not call the host wait API against
  an ID that is still only preallocated. The corrected driver observes model input.
- The initial reviewer omitted the outbox queue/worker boundary. Its coverage gap
  was addressed with the integration and live tests; an independent re-review
  confirmed the actual call graph and approved.

## Limits and omitted data

LSP could not initialize: workspace TypeScript 7.0.2 has no `tsserver.js`. Actual
tsgo checks provide type evidence; no LSP pass is claimed. The build reported two
moderate advisories in unchanged vendored LSP installations; no unrelated dependency
remediation was included. Legacy `config/loader.test.ts` retains a pre-existing
type assertion outside this diff.

No provider credentials, raw real-host configuration or authorization headers were
copied. Evidence was scanned for private-key/token/header patterns. No automatic
crash replay, distributed takeover, graph amendment or exactly-once external-side-
effect guarantee is claimed. A stale writer lock after an unclean crash fails closed.

CI, PR merge and task-worktree cleanup are subsequent delivery gates, not claimed
by these pre-push receipts.
