# OpenCode2 upstream-sync lane verification

## Scope

Task-owned worktree: `oh-my-openagent-sync-20260910`.
Merge inputs: upstream `cb3d88e9` and fork `51829514`.
Only `packages/omo-opencode2/` was edited by this lane. No commits, staging,
pushes, merge operations, dependency installs, DAG/Effect changes, or
background-task timing changes were performed.

This report records the native adapter lane. Live harness QA and
the merged repository gate remain the lead's responsibility.

## What changed

- Deleted `src/mcp/codegraph.ts`, including imports of upstream-deleted
  `@oh-my-opencode/utils/codegraph` and CodeGraph resolver exports.
- Removed CodeGraph registration, barrel exports, and built-in-name membership
  in `src/mcp/register.ts`, `src/mcp/index.ts`, and `src/mcp/types.ts`.
- Removed the retired schema field, settings schema, and inferred type in
  `src/config/schema.ts`. Existing `.strip()` behavior handles stale settings;
  no loader or migration framework was added. `src/config/index.ts` already
  re-exports the schema, so no separate barrel edit was necessary.
- Updated `src/commands/builtin-command-definitions.ts` to register
  `ulw-execute` with Atlas and load that shared skill instead of `start-work`.
- Updated the corresponding command pointers in
  `src/hooks/prometheus-md-only/{constants.ts,hook.ts}`. Guard behavior and
  hook registration did not change.
- Updated `AGENTS.md` to describe the three remaining built-ins and current
  execution command.
- Added/updated behavior coverage in `src/mcp/{types.test.ts,register.test.ts}`,
  `src/config/schema-mcp.test.ts`,
  `src/commands/register-builtin-commands.test.ts`, and
  `src/skills/register-shared-skills.test.ts`.

## Source-backed compatibility

- Upstream `packages/omo-opencode/src/features/builtin-commands/commands.ts`
  registers `ulw-execute`; its command-name union also uses `ulw-execute`.
- `packages/shared-skills/skills/ulw-execute/SKILL.md` declares frontmatter
  `name: ulw-execute`. The native adapter discovers the bundle dynamically;
  no production skill-loader edit was needed.
- The adapter package typecheck and complete native test suite pass against
  the merged workspace dependencies. No further removed-export compatibility
  edits were required by those checks.
- The only remaining `start-work` mentions in native source are a negative
  skill-ID assertion and an unchanged historical comment in the dispatch
  audit. There are no remaining executable command pointers to it.

## Failing-first observations

Commands below use the package directory unless stated otherwise.

1. Initial root `bun test packages/omo-opencode2/src/mcp/types.test.ts packages/omo-opencode2/src/mcp/register.test.ts`
   was blocked by an unresolved merge marker in v1 `agents/types.ts:48` loaded
   by the root preload. This was not treated as a behavioral RED.
2. `bun test --config /dev/null ./src/mcp/types.test.ts ./src/mcp/register.test.ts`
   bypassed the unrelated root preload while the merge was in progress:
   - Classification regression failed at `expect(builtin).toBe(false)`:
     expected `false`, received `true` for `codegraph`.
   - Registration could not import the removed upstream
     `@oh-my-opencode/utils/codegraph` module. There was no registration
     assertion-level RED; this import blocker is recorded rather than called
     a successful absence-regression run.
3. `bun test --config /dev/null ./src/config/schema-mcp.test.ts`:
   `2 pass`, `3 fail`. A valid legacy block was retained instead of stripped;
   malformed legacy fields and a scalar block threw Zod validation errors.
4. `bun test --config /dev/null ./src/commands/register-builtin-commands.test.ts`:
   `0 pass`, `1 fail`. The catalog contained `start-work` where the test
   required `ulw-execute`.

All three production changes followed the corresponding RED observations.

## Green observations

Intermediate gates:

- `bun test --config /dev/null ./src/mcp`: `15 pass`, `0 fail`.
- `bun test --config /dev/null ./src/config ./src/mcp`: `28 pass`, `0 fail`.
- `bun test --config /dev/null ./src/commands ./src/skills`: `5 pass`, `0 fail`.

Final gates, after all edits:

```text
# From worktree root, including the normal root preloads:
bun test packages/omo-opencode2/src
bun test v1.4.2 (744846f84)
357 pass
0 fail
809 expect() calls
Ran 357 tests across 63 files. [1003.00ms]

# From packages/omo-opencode2:
bun run typecheck
$ tsgo --noEmit -p tsconfig.json
# Exit 0
```

Assertions cover exactly three automatic MCP registrations, preservation of
explicit CodeGraph/custom servers and context7/grep_app/LSP overrides, and a
real project config file whose malformed stale CodeGraph settings must not
discard `disabled_mcps`. Schema cases retain unrelated agent/model settings.
Command and skill assertions use machine-consumed names, not prompt prose.

## LSP limitation

`lsp_diagnostics` was attempted on every changed TypeScript file (12 files).
Every request failed during server initialization:

```text
The TypeScript of the workspace (TypeScript 7.0.2 at <worktree>/node_modules/typescript/lib)
provides no tsserver.js. No other valid TypeScript installation was found. Exiting.
```

No clean LSP result is claimed. No LSP configuration or dependencies were
changed outside this lane. The package's native `tsgo` check passes.

## Review and remaining proof

- All touched TypeScript files are below 200 nonblank/non-line-comment lines
  (maximum measured: 103). No new runtime helpers, assertions, defensive
  layers, variant branches, or logging behavior were introduced.
- Existing schema parsing remains the trust boundary. The removed field
  cannot reject the rest of the adapter configuration.
- The new user-MCP test removes its temporary directory in `finally`.
- No live OpenCode2 process was spawned by this lane. The lead still needs
  isolated `OMO_SPIKE_TRACE` evidence for plugin load, remaining MCPs,
  CodeGraph absence, user MCP preservation, and command/skill availability.
- These unit results do not establish live connection status or host-store
  isolation. The root repository typecheck/build is also not claimed here.

## What was omitted

No credentials, auth stores, provider requests, environment dumps, or raw
secret-bearing logs were collected. Machine-local absolute paths in error
messages are represented as `<worktree>` above.
