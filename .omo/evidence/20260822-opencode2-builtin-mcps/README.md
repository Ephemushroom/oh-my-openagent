# opencode2 built-in MCPs on ctx.mcp.transform

**Date:** 2026-08-22
**Binary driven:** `opencode2 v0.0.0-beta-17823` (plugin dist byte-identical to pinned beta-17793)
**Feature:** the four v1 built-in MCP servers (context7, grep_app remote; lsp, codegraph local stdio) registered through `ctx.mcp.transform`, the MCP domain added in beta-17793. websearch is intentionally NOT ported: opencode2 ships a native `ctx.websearch` domain.

## WHAT WAS TESTED

1. **Unit gates.** `bun test packages/omo-opencode2/src` → 313 pass / 0 fail (17 new tests: context7 key normalization incl. placeholders, grep_app shape, lsp candidate priority dist > bun-source > bootstrap, source candidate requires readable daemon package.json [port bug caught by test], env path plumbing, codegraph gating via shared utils resolver, register user-priority / disabled_mcps / config schema). `bun run typecheck` → exit 0.
2. **Live QA** (`qa.sh`, both directions, isolated sandbox):
   - Case 1 (positive): default config, plugin wired from TS source. Asserts `omo.mcp.registered` names context7/grep_app/lsp, `omo.mcp.status` events exist, at least one server reaches `connected`, lsp registers, no error events.
   - Case 2 (negative): `disabled_mcps: [all four]` under `[opencode2]` → `omo.mcp.registered` reports `servers:[]` and no built-in name appears.
   - Isolation sweep: host `opencode.db` session count unchanged (1135 → 1135).

## WHAT WAS OBSERVED

Final tally **PASS=9 FAIL=0**. The status poll captured the full connection lifecycle:

```
context7: pending → pending → pending → pending → connected   (~2.0s, remote)
grep_app: pending → pending → pending → connected             (~1.5s, remote)
lsp:      pending → connected → connected → connected         (~0.5s, local daemon)
```

codegraph: not registered in the sandbox project (temp dir has no codegraph binary on its PATH resolution and no `.codegraph` provisioning) — the intended skip-not-fail behavior; on a real machine with `codegraph` on PATH it registers.

Two iterations were needed on the live run (both captured in git history of this bundle):

1. First run traced `servers:[]` — v2 `State` defers transform materialization when registration happens inside a batch, the same laziness `agent.transform` shows at setup (already documented in AGENTS.md). Fix: `await ctx.mcp.reload()` after the transform before reporting.
2. The status probe initially ran once before connections settled; replaced with a bounded poll (6 × 500ms) that stops when nothing is pending.

## WHY IT IS ENOUGH

- The load-bearing risk was "transform registered but never materialized" — indistinguishable from success at the unit level. The live `connected` statuses prove the servers were accepted by the harness AND completed protocol handshake: lsp via stdio to the vendored daemon, context7/grep_app via remote HTTP.
- Both-directions rule: the negative case proves the registration events and statuses come from the plugin's config processing (disabled_mcps empties them), not from any harness default.
- User-priority invariant (never overwrite a user-defined server) is unit-tested against a mock draft; it is deterministic draft logic not observable in this sandbox (no user MCP entries exist there).

## LIVE VERSUS UNIT PROOF

- Live: registration, materialization (reload), connection lifecycle for 3 servers, negative gating, isolation.
- Unit-only (no live branch drivable): user-defined server deferral, context7 placeholder-key normalization, codegraph binary resolution failure paths, bootstrap fallback selection.

## WHAT WAS OMITTED

- API keys read from host auth into child env only; never printed or committed.
- codegraph live connection not exercised (no binary in sandbox); its resolver is the same shared `@oh-my-opencode/utils` code v1 uses in production.
- Tool-level usage of the MCPs (calling `resolve-library-id` etc.) not driven; connection status is the contract `ctx.mcp` exposes and the tool surface belongs to the harness.

## Artifacts

- `qa.sh` — full harness (sandbox, both cases, isolation sweep)
- `out/case1-run.txt`, `out/case1-trace.ndjson` — positive case
- `out/case2-run.txt`, `out/case2-trace.ndjson` — negative case
