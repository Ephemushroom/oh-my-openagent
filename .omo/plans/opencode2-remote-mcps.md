# Plan: add v2 installer remote MCPs

Date: 2026-08-13
Branch: `feat/opencode2-remote-mcps`
Base: `dev` @ d3440fe48

## Goal

`install --platform=opencode2` writes the three remote HTTP MCPs that v1 injects at runtime:

- `websearch` → `https://mcp.exa.ai/mcp?tools=web_search_exa`
- `context7` → `https://mcp.context7.com/mcp`
- `grep_app` → `https://mcp.grep.app`

Each entry is `type: "remote"` with `codemode: false`. No API keys or headers are written to disk.

## Why

v2 plugin API has no `mcp` domain, so remotes cannot be injected at plugin load. PR #6 only landed local `codegraph` + `lsp`. Plan 5.G already listed the remotes.

## Files

1. `packages/omo-opencode/src/cli/install-opencode2.test.ts`
   - RED: `buildOpenCode2Entries` includes the three remotes after locals
   - RED: missing node/daemon still includes remotes (lsp skip unchanged)
   - RED: each remote has url + `codemode: false`, no headers
2. `packages/omo-opencode/src/cli/install-opencode2.ts`
   - `buildRemoteMcpEntries()` returns the three constants
   - `buildOpenCode2Entries` appends them after local entries
3. `packages/omo-opencode/src/cli/config-manager/update-opencode2-mcp-config.test.ts`
   - writer persists a remote url + `codemode: false`
   - existing user remote of the same name is not overwritten

## Out of scope

- Tavily / EXA_API_KEY / CONTEXT7_API_KEY headers (secrets must not land in opencode.json)
- `disabled_mcps` filtering (still unmapped; later Phase 6 config chain)
- Runtime injection via plugin API (impossible on current `@opencode-ai/plugin`)
- v1 `createBuiltinMcps` / `applyMcpConfig`

## Verification

- Unit: installer + writer tests green
- Typecheck: `bun run --cwd packages/omo-opencode` not needed; run the two test files + `bunx tsgo --noEmit` scoped if cheap, else package typecheck
- Real QA: call `updateOpenCode2McpConfig` against an isolated temp `opencode.json` (not the user's real config). Assert the three remotes appear. Isolation: real `~/.config/opencode` untouched (shasum before/after).
- Evidence: `.omo/evidence/20260813-opencode2-remote-mcps/`
