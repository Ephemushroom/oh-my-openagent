# QA Evidence: opencode2 MCP installer (`--platform=opencode2`)

Date: 2026-08-12 | PR: #6 (merge commit adf4494ee) | Branch: `feat/opencode2-mcp-installer` | Base: `dev` @ ad2d1aaf9

## Scope

New CLI path `install --platform=opencode2` that writes managed MCP servers
(codegraph + lsp) into the opencode2 config (`opencode.jsonc`), preserving
user-owned servers/comments, with idempotency and a JSONC-safe writer.

## WHAT WAS TESTED

### 1. Unit gate (hermetic, `bun test`)

Touched suites, all green:

```
76 pass, 0 fail  (7 files)
```

- `update-opencode2-mcp-config.test.ts` — writer: JSONC preservation, user
  servers survive, fail-closed on malformed config, idempotent no-rewrite
- `install-opencode2.test.ts` — entry builders + degradation (8 tests:
  codegraph/lsp builders, missing node/daemon → lsp skipped without throw,
  missing codegraph → fail closed)
- `cli-installer.platform.test.ts` — opencode2 branch routes to
  `runOpenCode2Installer` and no other harness path runs
- `install-validators.test.ts` / `senpi-platform-flag.test.ts` /
  `star-request.test.ts` — platform plumbing (`hasOpenCode2` derivation,
  platform list, star repo map)
- `tui-install-prompts.test.ts` — TUI config shape carries `hasOpenCode2`

Typecheck: `tsgo --noEmit -p tsconfig.json` → clean.

### 2. Real-surface QA (isolated sandbox, `OPENCODE_CONFIG_DIR` redirect)

No real `~/.config/opencode` touched — all writes went to
`%TEMP%\omo-qa-*` sandboxes.

**2a. Direct `runOpenCode2Installer()` (sandbox with user server + comment):**

- Result: `{ changed: true, configPath: <sandbox>/opencode.jsonc,
  backupPath: <sandbox>/opencode.jsonc.backup-<ts>, added: ["codegraph"] }`
- `codegraph` entry written: command
  `["C:\Users\Bryan\.bun\bin\codegraph.exe", "serve", "--mcp"]`, environment
  `CODEGRAPH_INSTALL_DIR / CODEGRAPH_NO_DOWNLOAD / CODEGRAPH_TELEMETRY /
  DO_NOT_TRACK`, `codemode: false`
- `lsp` NOT added — `@code-yeongyu/lsp-daemon` absent from node_modules →
  `resolveLspDaemonCli()` returns "" → degradation path (skip, no throw).
  This is exactly the designed behavior.
- User server `user-server`, its comment, and `mcp.my-key` all preserved.
- Idempotent re-run: `{ changed: false, added: [] }`, backup count stays 1.

**2b. Real CLI entry (`cli/index.ts install --no-tui --platform=opencode2`):**

- Output: `[OK] OpenCode2 MCP config -> <sandbox>/opencode.jsonc added: codegraph`,
  `Platform: opencode2` in summary box, EXIT=0
- Written config: `codegraph` entry present; user `user-server`, comment,
  and `other-key: 42` preserved.
- Idempotent re-run: `[OK] ... (nothing to add)`, backup count stays 1.
- Correct entry point: `cli-program.ts` only exports `runCli()`; the actual
  parse happens in `cli/index.ts`. Running `cli-program.ts` directly is a
  silent no-op (EXIT=0, zero output) — that was the initial red herring.

## CI VERIFICATION (PR #6, merge commit adf4494ee)

First CI run caught a real regression: `build:cli-node` (Node-targeted
bundle) failed with `Browser build cannot import() Bun builtin: "bun"`.
Root cause: `resolveNodeRuntime()` used `await import("bun")`. Fixed by
swapping to the node-safe `bunWhich` from `@oh-my-opencode/utils`
(graceful PATH fallback). Verified locally `bun run build:cli-node` →
EXIT 0, then pushed (c8af63ef4).

Final matrix on head c8af63ef: **16/17 jobs green** — build, typecheck
(all 3 OS), test (macos/ubuntu), codex-compatibility (all 3 OS),
senpi-compatibility (all 3 OS), omo-ai-payload-check,
lazycodex-published-smoke, block-master-pr, labels.

Two non-blocking fails, both proven unrelated to this PR:
- `test (windows-latest)` — `script/omo-ai-publish-shape.test.ts`
  "missing DIST_TAG derivation block"; reproduced identically on base
  ad2d1aaf9 (6 pass 1 fail) → pre-existing upstream defect.
- `cla` — known fork issue, same as PRs #1-4.

## WHY IT IS ENOUGH

- Writer/plumbing behavior pinned by 76 hermetic unit tests (RED→GREEN).
- Real install path proven end-to-end through the actual CLI binary entry,
  in an isolated config dir, on Windows (real `codegraph.exe` resolution).
- Degradation (missing lsp daemon) observed live, not just unit-tested.
- Idempotency proven at both layers (no duplicate writes, no backup churn).
- The one CI regression (node-targeted bundle vs `import("bun")`) was
  caught, fixed, and verified green on the final matrix.

## WHAT WAS OMITTED

- No secrets/env dumps. Sandbox configs contain no credentials.
- Real `codegraph` MCP server handshake (MCP protocol) not exercised — the
  entry shape is validated; server boot is out of scope for this change.
- macOS/Linux not run locally (CI covers the matrix).
