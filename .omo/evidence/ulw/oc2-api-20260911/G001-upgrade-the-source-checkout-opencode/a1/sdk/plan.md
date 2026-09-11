# SDK migration lane

Work in the lead-provided task worktree. No commits, pushes, global installs, command edits, installer edits, QA-script edits, core edits or documentation edits outside this evidence folder.

## Explored mechanism

`src/index.ts` imports Plugin.define and registers agents, skills, MCPs, tools and hooks using the Promise Context. Agent transforms read the asynchronously captured catalog. Tools and session orchestration consume Context types, while skill registration constructs branded schema values. Commands have an independently owned breaking editor contract and are excluded.

## Changes and verification

1. Pin tests with `bun test packages/omo-opencode2/src/agents packages/omo-opencode2/src/skills packages/omo-opencode2/src/mcp`; capture output in pin.log.
2. Update only the two SDK dependencies and outdated SDK reference in packages/omo-opencode2/package.json to @opencode/plugin and @opencode/schema, exact 0.0.0-beta-19425. Resolve bun.lock with `bun install --ignore-scripts`; inspect every lock diff and retain unrelated versions, especially root zod 4.4.3.
3. Replace only SDK import namespaces in src/index.ts; agents/{model-resolution,register-configured,register-subagents,register-primaries,register-categories,register.test}.ts; orchestration/{child-session,task-engine-guidance.test,task-engine,background-tools,task-tool}.ts; mcp/{register,register.test,types}.ts; skills/{register-shared-skills,register-shared-skills.test}.ts; features/btw/{tool-guard,tools,tools.test,tool-guard.test,register}.ts; features/monitor/delivery.ts; tools/{session-manager,look-at,monitor,hashline-edit}/register.ts; hooks/comment-checker/register.ts; hooks/write-existing-file-guard/{hook,tool-execute-before-handler}.ts; hooks/prometheus-md-only/hook.ts; hooks/register-context-hooks.ts; hooks/hashline-read-enhancer/register.ts.
4. Rename imported CatalogDraft and SkillDraft types to CatalogEditor and SkillEditor. Preserve local function names and behavior. Use current SDK diagnostics to identify any further required type adaptations, never compatibility facades or new assertions/suppressions. Existing unrelated assertions and oversized entrypoint stay out of this mechanical scope.
5. Attempt LSP diagnostics for each edited source file without installing a server. Run package tsgo and scoped agent/skill/MCP tests, plus broader affected adapter tests where possible. Record expected command integration errors separately.
6. Record resolved package versions, exact owned changes, output logs, residual errors and live-QA boundary in README.md. Lead owns integrated real-host green QA after command migration; existing live red receipts are in sibling loader-red/.

No authored prompt/prose assertions will be added. This lane changes SDK contracts, not feature semantics.

## Compiler-discovered adaptations

The first package tsgo run exposed nullable compaction content in SessionContext flowing through index.ts -> configured goal registration -> goal auto-start. Widen only hooks/goal/auto-start.ts GoalContextEvent content text to string | null. The existing string filter already handles it. Add a focused nullable-compaction input fixture to a separate auto-start-sdk.test.ts and run it plus existing goal tests. SkillEditor adds a required get member, so add get to the existing skills test fixture and check that file with tsgo as package tsconfig excludes tests.
