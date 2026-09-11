# SDK lane handoff

## Result

Completed the non-command SDK migration. Both direct SDK dependencies resolve to exact `0.0.0-beta-19425`, using the official Promise API. No non-command API incompatibility remains in package tsgo output. One command integration error remains for the lead.

No commits, pushes, PRs, global installs, root manifest changes, command edits, installer edits, core edits, QA script edits or user configuration edits were performed by this lane.

## What changed

- Replaced the two old scoped SDK dependencies and all 33 owned source-file SDK import namespaces.
- Imported `CatalogEditor` and `SkillEditor` instead of the old Draft types. Local `captureCatalogDraft` function naming is unchanged to avoid an unrelated rename.
- Widened the goal auto-start structural content type to accept `text: null`, which the new SDK allows on compaction content. Runtime filtering already accepts only string text, so no handler logic changed.
- Added a focused nullable-compaction fixture with a compile-time `satisfies GoalContextEvent` check and an observable objective assertion.
- Updated the skill editor test fixture with the required `get` method and official `Skill.ID.make` constructors for branded expected IDs.

## Exact owned file list

Repository-relative paths, 37 files total (35 TypeScript source/test files):

```text
bun.lock
packages/omo-opencode2/package.json
packages/omo-opencode2/src/index.ts
packages/omo-opencode2/src/agents/model-resolution.ts
packages/omo-opencode2/src/agents/register-configured.ts
packages/omo-opencode2/src/agents/register-subagents.ts
packages/omo-opencode2/src/agents/register-primaries.ts
packages/omo-opencode2/src/agents/register-categories.ts
packages/omo-opencode2/src/agents/register.test.ts
packages/omo-opencode2/src/orchestration/child-session.ts
packages/omo-opencode2/src/orchestration/task-engine.ts
packages/omo-opencode2/src/orchestration/task-engine-guidance.test.ts
packages/omo-opencode2/src/orchestration/task-tool.ts
packages/omo-opencode2/src/orchestration/background-tools.ts
packages/omo-opencode2/src/mcp/register.ts
packages/omo-opencode2/src/mcp/register.test.ts
packages/omo-opencode2/src/mcp/types.ts
packages/omo-opencode2/src/skills/register-shared-skills.ts
packages/omo-opencode2/src/skills/register-shared-skills.test.ts
packages/omo-opencode2/src/features/btw/tool-guard.ts
packages/omo-opencode2/src/features/btw/tool-guard.test.ts
packages/omo-opencode2/src/features/btw/tools.ts
packages/omo-opencode2/src/features/btw/tools.test.ts
packages/omo-opencode2/src/features/btw/register.ts
packages/omo-opencode2/src/features/monitor/delivery.ts
packages/omo-opencode2/src/tools/hashline-edit/register.ts
packages/omo-opencode2/src/tools/look-at/register.ts
packages/omo-opencode2/src/tools/monitor/register.ts
packages/omo-opencode2/src/tools/session-manager/register.ts
packages/omo-opencode2/src/hooks/comment-checker/register.ts
packages/omo-opencode2/src/hooks/hashline-read-enhancer/register.ts
packages/omo-opencode2/src/hooks/prometheus-md-only/hook.ts
packages/omo-opencode2/src/hooks/write-existing-file-guard/hook.ts
packages/omo-opencode2/src/hooks/write-existing-file-guard/tool-execute-before-handler.ts
packages/omo-opencode2/src/hooks/register-context-hooks.ts
packages/omo-opencode2/src/hooks/goal/auto-start.ts
packages/omo-opencode2/src/hooks/goal/auto-start-sdk.test.ts
```

`owned.diff` captures tracked owned changes; the new `auto-start-sdk.test.ts` is untracked and must be included by the lead when staging. The command test changes visible in the shared worktree belong to the lead, not this lane.

## What was tested and observed

Commands run from the task worktree root unless otherwise stated:

| Check | Command | Result | Artifact |
|---|---|---|---|
| PIN | `bun test packages/omo-opencode2/src/agents packages/omo-opencode2/src/skills packages/omo-opencode2/src/mcp` | 47 pass, 0 fail | pin.log |
| Resolution | `bun install --ignore-scripts` | Official packages installed | install.log |
| Frozen resolution | `bun install --ignore-scripts --frozen-lockfile` | Completed without lock rewrite | frozen-install.log |
| First package diagnostics | `./node_modules/.bin/tsgo --noEmit -p packages/omo-opencode2/tsconfig.json` | Command mismatch plus nullable goal content mismatch | tsgo-initial.log |
| Fixture RED | Strict standalone tsgo on auto-start-sdk.test.ts and register-shared-skills.test.ts | Rejected nullable text, missing SkillEditor.get and unbranded expected IDs | sdk-fixtures-red.log |
| Fixture GREEN | Same strict standalone tsgo command | Exit 0 | sdk-fixtures-green.log; verification-status.log |
| Final package diagnostics | `./node_modules/.bin/tsgo --noEmit -p packages/omo-opencode2/tsconfig.json` | Exit 1, command mismatch only | tsgo-final.log; verification-status.log |
| Final scoped tests | Agent, skill and MCP folders plus auto-start-sdk.test.ts | Exit 0: 48 pass, 0 fail | verification-status.log |
| Broader affected suite | `bun test packages/omo-opencode2/src/agents packages/omo-opencode2/src/skills packages/omo-opencode2/src/mcp packages/omo-opencode2/src/hooks packages/omo-opencode2/src/orchestration packages/omo-opencode2/src/features packages/omo-opencode2/src/tools` | 343 pass, 0 fail, 763 assertions across 59 files | affected-tests.log |
| Diff validation | `git diff --check` | Passed | Observed in tool result |
| SDK runtime import | Bun import of Plugin and Skill from the adapter package directory | Plugin.define is a function, Skill.ID.make works; both versions are beta-19425 | resolved-runtime.log |

The complete standalone tsgo command and explicit exit statuses are preserved in verification-status.log. It uses `--ignoreConfig --noEmit --skipLibCheck --strict --target ESNext --module ESNext --moduleResolution bundler --types bun-types` and the two fixture paths. An initial invocation without `--ignoreConfig` returned TS5112; rerunning with the required TS7 flag produced the genuine red fixture errors. A runtime import probe from the workspace root failed because these dependencies are package-local; the corrected probe ran from packages/omo-opencode2 and passed.

### Dependency drift proof

Read installed package manifests at `packages/omo-opencode2/node_modules/@opencode/{plugin,schema}/package.json`. Both versions are `0.0.0-beta-19425`; runtime receipt is resolved-runtime.log.

`lock-existing-changes.log` compares every previous lock package record with the regenerated record. Only twelve records under the old OpenCode2 dependency tree disappeared. Every other pre-existing record remains byte-equivalent after JSON parsing, including root `zod@4.4.3`. No unrelated package version was upgraded. `lock.diff` preserves the full resolver output. The larger lockfile is required by the new SDK's `@opencode/util` dependency tree and Effect rc.112 dependencies; old v1 `@opencode-ai/plugin@1.18.22` remains intact.

### Remaining command error (lead-owned)

```text
packages/omo-opencode2/src/index.ts(121,35): TS2345
Context is not assignable to BuiltinCommandsRegistrationContext.
Transform<CommandEditor> is not assignable to the old CommandDraft callback.
CommandEditor lacks list, get, update, remove.
```

This is the call into the unchanged command registration module, not an unresolved SDK error in the non-command implementation. Do not add a facade: finish the lead-owned executable command migration and rerun package tsgo. The package gate is NOT reported as green.

### LSP limitation

Attempted `lsp_diagnostics` individually for all 35 TypeScript files listed above. Every attempt returned:

```text
Request initialize failed: workspace TypeScript 7.0.2 provides no tsserver.js.
No other valid TypeScript installation was found. Exiting.
```

No server was installed and no configuration changed. Package tsgo and standalone fixture tsgo supply compiler evidence; no LSP pass is claimed.

## Why it is enough for this lane

The package compiler now identifies only the intentionally excluded command seam. Existing registration and feature tests remain green against the new runtime SDK, and the sole non-command type adaptation has red/green compile evidence plus a runtime objective test. No Promise-to-Effect rewrite, dispatch change, new wrapper, fallback or feature flag change was introduced.

Architectural self-review: this is an import/type migration, preserving existing module responsibilities, logging, parameter shapes and runtime boundary behavior. The new test owns only nullable goal-context handling and cleans up its temporary directory. No new type assertion, non-null assertion, suppression, helper, defensive layer, negative-form name, variant branch or prose assertion was introduced. Existing unrelated assertions and prose tests were not broadened or cleaned up. `source-loc.log` records source measurements: index.ts remains 285 code lines with only its import edited; register.test.ts (214), register-context-hooks.ts (201), task-tool.ts (230) remain in the warning band with only import changes. Split those units before future growth, not in this SDK migration.

## Live versus unit proof and omitted work

Lead-provided real-host red proof is in sibling loader-red/. This lane did not launch OpenCode2 or claim a live-host green pass: the command integration is incomplete and the user explicitly assigned integrated real-host QA to the lead. Full repository build/typecheck/test and command suite remain downstream integration gates. No secret-bearing environment dumps, credentials or host configuration contents were captured. SDK imports, local tests and package resolution did not intentionally access real harness session stores.
