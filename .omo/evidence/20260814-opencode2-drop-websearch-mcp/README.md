# QA Evidence: drop websearch MCP from opencode2 installer

Date: 2026-08-14 | Branch: `feat/opencode2-drop-websearch-mcp` | Base: `dev` @ bcb8ed0c6

## Scope

Stop writing `mcp.servers.websearch`. OpenCode2 already ships a native Exa-backed `websearch` tool. Keep `context7` and `grep_app`.

## What was tested

### Unit

`bun test packages/omo-opencode/src/cli/install-opencode2.test.ts`

**9 pass / 0 fail.**

RED→GREEN: four tests failed while `websearch` was still in `REMOTE_MCP_ENTRIES`, then passed after it was removed.

### Isolated installer write

`bun .omo/evidence/20260814-opencode2-drop-websearch-mcp/qa.ts`

- Wrote into a temp `opencode.json`: `codegraph`, `lsp`, `context7`, `grep_app`.
- No `websearch` name, no `mcp.exa.ai` url.
- Real `~/.config/opencode/opencode.json` SHA256 unchanged.

## Why this is enough

The change is the managed remote list. Unit tests pin the names; the isolated write proves the writer no longer emits the Exa MCP entry and does not touch the user's real config.

## What was omitted

- Did not delete an already-written user `mcp.servers.websearch` (installer never overwrites or removes existing names).
- Did not spawn a live opencode2 session.
