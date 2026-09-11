# Lazy registration remediation handoff

## Changed source

- `packages/omo-opencode2/src/agents/register-configured.ts`: await the native
  agent list after all three transforms are registered, before capturing the
  return object's prompt and exposing registration sets. Return `models`, a
  readonly map derived from materialized agent model refs.
- `packages/omo-opencode2/src/index.ts`: remove ineffective post-return reload;
  use materialized models for direct and category task dispatch. Category
  membership still fails closed. No lookup of category IDs in the agent model
  requirement table remains.
- `packages/omo-opencode2/src/agents/register-configured.test.ts`: four deferred
  regression cases covering returned catalogs, configured Sisyphus base equality,
  oracle override and quick override. Transform stores callbacks, list executes
  them. SDK AgentEditor and Agent.Info.default supply a typed mutable fixture;
  the intersection with Agent.Info preserves the branded readonly list view.
  Each case uses a unique temporary HOME restored afterward.
- `register-primaries.ts`, `register-subagents.ts`, `register-categories.ts`:
  signature-only narrowing to the SDK transform capability. No runtime changes.

## Commands and observations

All commands ran from the lead-owned oc2-api worktree.

1. `bun test packages/omo-opencode2/src/agents/register-configured.test.ts`
   before the runtime fix: `red.log`, 2 pass and 4 fail. Failure values were empty
   catalogs, undefined captured Sisyphus prompt, and missing dispatch models.
   `green.log` after materialization: 6 pass and 0 fail.
2. `bun test packages/omo-opencode2/src/agents/register.test.ts packages/omo-opencode2/src/agents/register-configured.test.ts`
   after the final changes: `registration-tests-final.log`, 20 pass, 0 fail,
   86 assertions. No tests skipped or weakened.
3. `bunx tsgo --noEmit -p packages/omo-opencode2/tsconfig.json`:
   exit 0, `typecheck-final.log` (empty means no diagnostics).
4. `bunx tsgo --ignoreConfig --noEmit --strict --skipLibCheck --target esnext --module esnext --moduleResolution bundler --types bun-types packages/prompts-core/src/markdown-modules.d.ts packages/omo-opencode2/src/agents/register-configured.test.ts`:
   exit 0, `test-typecheck-final.log` (empty means no diagnostics).
   The initial test-inclusive compile in `test-typecheck.log` exposed the unused
   list response location requirement plus omitted ambient Markdown declarations.
   The final consumed capability returns only the SDK response data; the command
   explicitly includes the existing Markdown declaration. No suppressions or
   additional dependencies were introduced.
5. LSP diagnostics attempted separately on all six changed files. Every attempt
   failed initialization with: `The TypeScript of the workspace (TypeScript
   7.0.2 .../node_modules/typescript/lib) provides no tsserver.js. No other valid
   TypeScript installation was found. Exiting.` No LSP installation attempted;
   successful native tsgo checks above cover production and the new fixture.

## Why this covers the local fix

The regression runs real registration builders against the deferred SDK-shaped
editor, not mocked registration functions. Return-value assertions run without a
test-side list call, so removing the production materializing read reproduces
the bug. Prompt equality derives from the input model and the actual registered
artifact, never authored wording. Direct and category overrides differ from the
built-in fallback models. Index consumes the same materialized map, eliminating
the second resolution path that ignored those overrides.

Self-review: no new trust boundary, tagged variant dispatch, type assertion,
non-null assertion, defensive catch, domain helper, logging, or session write.
Registration remains one responsibility. Shared gates and default-off feature
flags are unchanged. Nonblank/non-line-comment counts: register-configured 68,
test 106, primaries 147, subagents 81, categories 71, index 276. The inherited
oversized index is reduced locally; no structural rewrite was authorized.

## Lead-owned verification and limitations

No full suite, live session, host QA, commits, or changes outside the requested
source scope and this evidence directory. The lead must drive direct/category
task execution and Sisyphus rebake, full gates, and delta review. These unit logs
are not claimed as live-harness proof.

The existing package AGENTS.md still incorrectly says agent.reload forces
materialization. Documentation was explicitly excluded from this worker's scope;
the lead should correct that statement with its documentation updates.

No secrets, environment dumps, auth headers, or real-provider traffic are in
these artifacts. The red prompt diff is generated repository prompt text.
