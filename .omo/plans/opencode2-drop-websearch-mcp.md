# Plan: drop websearch MCP from opencode2 installer

Date: 2026-08-14
Branch: `feat/opencode2-drop-websearch-mcp`
Base: `dev` @ bcb8ed0c6

## Goal

Stop writing `mcp.servers.websearch` (Exa MCP). OpenCode2 already ships a native `websearch` tool backed by Exa. Keep `context7` and `grep_app`.

## Why

Two Exa entry points (`websearch` native + `web_search_exa` MCP) waste tool-schema budget and can double-hit Exa. Plan 5.G already marked native `ctx.websearch` as the replacement path.

## Files

1. `packages/omo-opencode/src/cli/install-opencode2.test.ts`
   - remotes are `context7`, `grep_app` only
   - assembled names no longer include `websearch`
2. `packages/omo-opencode/src/cli/install-opencode2.ts`
   - remove the websearch constant from `REMOTE_MCP_ENTRIES`
3. Writer tests stay as-is (they use a generic remote fixture, not the managed name list)

## Out of scope

- Uninstall / rewrite of already-written user `mcp.servers.websearch` (installer never overwrites existing names)
- `ctx.websearch.transform` adapter
- Tavily

## Verification

- Unit: installer tests green
- Isolated write: temp `opencode.json` gets codegraph, lsp, context7, grep_app — not websearch
- Real `~/.config/opencode` hash unchanged
- Evidence: `.omo/evidence/20260814-opencode2-drop-websearch-mcp/`
