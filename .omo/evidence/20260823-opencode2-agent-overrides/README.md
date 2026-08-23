# OpenCode2 Agent Override Wiring QA

**Date:** 2026-08-23  
**Binary:** see `out/version.txt`  
**Change:** pass the already-parsed `[opencode2].agents` and
`[opencode2].default_agent` config into primary, subagent, and category
registration.

## WHAT WAS TESTED

1. `bun test packages/omo-opencode2/src`: 354 pass / 0 fail.
2. `bun run typecheck`: exit 0 across the workspace.
3. TypeScript no-excuse audit on all three changed TypeScript files: no
   violations. TypeScript LSP diagnostics were unavailable because the user
   previously declined installing the language server; `tsgo` is the compile
   gate.
4. `qa.sh` drove the real `opencode2` binary in two fully isolated sandboxes:
   - positive: primary `sisyphus`, subagent `oracle`, and category `quick` each
     received a deliberately non-default model/variant; `default_agent` was
     `atlas`;
   - negative: no `[opencode2]` override config, so no `qa-*` model appeared and
     the default remained `sisyphus`.
5. Host-store isolation compared `session_v2` row counts before and after.

## WHAT WAS OBSERVED

`out/assertions.json` records all six behavior assertions as true:

- positive primary model override applied;
- positive subagent model override applied;
- positive category model override applied;
- positive `default_agent` applied;
- negative run contained no QA override models;
- negative default remained `sisyphus`.

Final live tally: `PASS=4 FAIL=0` (`out/qa-summary.txt`). The host store stayed
unchanged (`out/host-isolation.txt`).

## WHY IT IS ENOUGH

The root cause was a call-site omission, not parsing or model resolution: all
three registrar functions already accepted `agentOverrides`, but `index.ts`
never supplied them. The unit test pins config/default resolution, while the
positive live trace proves the complete path from an actual `.omo/omo.json`
file through plugin setup into each of the three runtime registries. The
negative run prevents a test that would pass if overrides were always injected.

## LIVE VERSUS UNIT PROOF

- Live: config loading, all three registration paths, default selection, and
  host isolation.
- Unit/type: fallback-to-`sisyphus` when `default_agent` is absent, workspace
  compilation, and source hygiene.

## WHAT WAS OMITTED

- No real provider call was made to the QA override models; the session itself
  used `zhipuai/glm-4.7`. The contract under test is registry selection, which
  `OMO_SPIKE_TRACE` exposes directly.
- Credentials were read into the isolated child environment only and never
  written to the evidence bundle.

## Artifacts

- `qa.sh`
- `out/positive-run.txt`, `out/positive-trace.ndjson`
- `out/negative-run.txt`, `out/negative-trace.ndjson`
- `out/assertions.json`, `out/host-isolation.txt`, `out/qa-summary.txt`
- `out/version.txt`
