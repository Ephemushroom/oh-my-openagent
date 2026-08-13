# QA Evidence: opencode2 installer remote MCPs

Date: 2026-08-13 | Branch: `feat/opencode2-remote-mcps` | Base: `dev` @ d3440fe48

## Scope

`install --platform=opencode2` now writes the three remote HTTP MCPs that v1 injects at plugin load (`websearch`, `context7`, `grep_app`) into `opencode.json(c)` `mcp.servers`. v2 has no plugin MCP domain, so this is the only injection path.

## What was tested

### Unit

`bun test packages/omo-opencode/src/cli/install-opencode2.test.ts packages/omo-opencode/src/cli/config-manager/update-opencode2-mcp-config.test.ts`

**15 pass / 0 fail.**

- `buildRemoteMcpEntries` returns the three remotes with urls + `codemode: false` and no headers/env.
- `buildOpenCode2Entries` order is `codegraph`, `lsp`, then remotes.
- Missing node/daemon still skips lsp and keeps remotes.
- Writer persists a remote url + `codemode: false`.
- A user-owned remote of the same name is not overwritten.

RED→GREEN: first run failed with `Export named 'buildRemoteMcpEntries' not found`; green after the export landed.

### Isolated installer write (real function, fake config)

`bun .omo/evidence/20260813-opencode2-remote-mcps/qa.ts`

- Built the full managed entry list and wrote it into `.omo/evidence/20260813-opencode2-remote-mcps/out/isolated/opencode.json`.
- First write added `codegraph`, `lsp`, `websearch`, `context7`, `grep_app`.
- Second write was idempotent (`changed: false`).
- Written file contains the three remote urls and `codemode: false`.
- Real `~/.config/opencode/opencode.json` SHA256 unchanged (`isolationClean: true`).

Artifacts: `out/qa-report.json`, `out/written-opencode.json`, `out/real-hash-before.txt`.

## Why this is enough

This change only expands the installer entry list and relies on the existing jsonc writer. The unit tests pin the contract; the isolated write proves the writer actually persists remotes without touching the user's real OpenCode config.

## What was omitted

- No secrets/env dumps. No EXA/CONTEXT7 keys are written (by design).
- Did not spawn a live opencode2 session to call the remote MCP tools (network + provider keys; not required to prove the installer write).
- `disabled_mcps` filtering is still unmapped (Phase 6 config chain).
