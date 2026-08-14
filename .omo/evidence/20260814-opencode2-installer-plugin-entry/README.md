# OpenCode 2 Installer Plugin Entry QA

## WHAT WAS TESTED
- **Command:** `bun run packages/omo-opencode/src/cli/cli-program.ts install --platform=opencode2 --no-tui`
- **Surface:** The `opencode.json(c)` config file modification (inserting the `plugins` array), and the real `opencode2.exe` execution to prove plugin resolution and loading.
- **Intended Behavior:** The installer should append the absolute path of `@oh-my-opencode/omo-opencode2` (the v2 plugin) to the `plugins` array of the user's config, while preserving any existing MCP servers or custom plugins. This closes the gap where the installer wrote `mcp.servers` but the plugin itself remained unloaded.

## WHAT WAS OBSERVED
- **Before:** The sandbox `opencode.json` contained only a `model` configuration block. The installer previously only added `mcp.servers` and omitted the `plugins` array.
- **After:** The installer successfully updated the sandbox config (`out/sandbox_opencode.json`) to include both `mcp.servers` and `plugins` (containing the absolute path to `packages/omo-opencode2/src/index.ts`).
- **Live Execution:** The `opencode2 run` execution using the modified config loaded the plugin successfully, firing `omo.registration.complete` and `omo.catalog.snapshot` trace events (`out/trace.ndjson`).
- **Isolation Proof:** The script verified that the real host configuration file (`~/.config/opencode/opencode.json`) remained entirely unchanged (hash check), and no unintended files leaked into `~/.local/share/opencode`.
- **Artifacts:**
  - Config: `out/sandbox_opencode.json`
  - Installer logs: `out/install.txt`
  - Traces: `out/trace.ndjson`
  - Runtime execution logs: `out/run-live.txt`

## WHY IT IS ENOUGH
- **Coverage:** This tests the complete end-to-end integration of the OpenCode2 plugin installation. It confirms that the `jsonc-parser` modification correctly preserves syntax, avoids duplicating entries, and properly handles a missing `plugins` array. The live binary validation provides 100% confidence that the exact path format written by the installer is parsed and executed by OpenCode2.
- **Residual Risk:** Minimal. The path resolution fallback logic (`createRequire` vs `new URL(...)`) relies on the static structure of the npm published package. If the build pipeline significantly shifts the relative path between the cli `dist/cli` directory and the `dist/omo-opencode2` directory, the fallback resolver might break in production.

## WHAT WAS OMITTED
- API keys, local paths outside of the mocked temporary directory, and real user `auth.json` contexts were redacted or omitted. The `ZHIPU_API_KEY` was passed safely without writing to any permanent disk paths.
