# opencode2 pin bump: next-17444 → beta-17793

**Date:** 2026-08-21
**Binary driven:** `opencode2 v0.0.0-beta-17823` (`~/.bun/bin/opencode2.exe`, auto-updated)
**Pinned plugin/schema packages:** `0.0.0-beta-17793` (byte-identical dist in 17823; verified by MD5 over every file in `dist/`)

## WHAT WAS TESTED

1. **Type-level compatibility.** Downloaded and diffed `@opencode-ai/plugin`
   tarballs for `0.0.0-next-17444`, `0.0.0-beta-17793`, and `0.0.0-beta-17823`.
   All changes additive: new `ctx.mcp` (MCP transform domain) and `ctx.storage`
   (KV + scan) domains; `session.hook("model.request")` (mutable `baseURL?` +
   `headers`); `SessionDomain` gains `switchAgent`/`switchModel`/`rename`/`wait`;
   `Hooks` widened to `ModelHooks` (superset, adds optional `providerID`
   scoping; call signature unchanged); new `v1/` compat subpath export.
2. **Gates.** `bun test packages/omo-opencode2/src` → 296 pass / 0 fail;
   `bun run typecheck` → exit 0. Zero adapter code changes required.
3. **Live QA** (`qa.sh`, both directions):
   - Case 1 (positive): isolated sandbox, plugin wired from TS source, one
     prompt exercising registration → hashline read (LINE#ID tagging) →
     `hashline_edit` → on-disk verification. 8 assertions on the
     `OMO_SPIKE_TRACE` NDJSON + disk state.
   - Case 2 (negative): same binary, plugin absent → zero trace events,
     proving the events in case 1 belong to the plugin, not the harness.
   - Isolation sweep: host `opencode.db` session count unchanged (1135 → 1135).

## WHAT WAS OBSERVED

Final tally **PASS=10 FAIL=0**:

```
PASS  case1-trace-non-empty
PASS  plugin-booted (1)                      [omo.registration.complete]
PASS  agents-registered-sisyphus             [omo.agent.registered]
PASS  hashline-read-enhancer-fired           [omo.hashline.tag-applied x3]
PASS  hashline-edit-applied                  [omo.hashline.edit-accepted]
PASS  no-plugin-errors
PASS  edit-landed-on-disk                    [hello.ts hello→goodbye]
PASS  sandbox-store-exists
PASS  no-plugin-no-trace                     (negative case)
PASS  host-store-isolated (1135)
```

Full captured trace: `out/case1-trace.ndjson` (29 event types, 317 events,
including 22 `omo.agent.registered`, `omo.config.loaded`,
`omo.context.composed` ×6, and default-off confirmations for
goal/todo/boulder/monitor).

## WHY IT IS ENOUGH

- The pin bump's only risk was silent type drift between the pinned plugin
  package and the binary's runtime API. That risk is covered by (a) the
  byte-identity check between the pinned 17793 dist and the 17823 binary's
  matching package, and (b) a live session driving registration, context
  composition, tool execution, and file mutation through the real binary.
- Both-directions rule: the negative case proves trace events are the plugin's,
  not the harness's.
- The three documented API limits (shell registry unreachable, SessionDomain
  without `list`/`messages`, aisdk hooks unreliable) were re-verified at the
  type level against the beta-17793 dist and at the source level against the
  opencode `v2` branch (`packages/core/src/aisdk-native.ts`): still true, with
  the aisdk finding refined — core now resolves nine major `@ai-sdk/*` packages
  through a NATIVE map that bypasses the plugin hook path entirely.

## LIVE VERSUS UNIT PROOF

All assertions above are live (real binary, real model call on
`zhipuai/glm-4.7`, real file edit). The API-limit re-checks are type/source
level, matching how they were originally established; no live branch exists to
drive (a plugin cannot call what the Context does not expose).

## WHAT WAS OMITTED

- API keys were read from the host auth store into the child env only; never
  printed, copied into the bundle, or committed.
- `models.json` global catalog refresh by the binary is documented exclusions
  per the opencode2-qa skill (no session/project state).
- Monitor/goal/todo/boulder features were default-off in this run (their gates
  each have their own dedicated prior evidence bundles); the trace records
  `omo.monitor.disabled` etc. as expected.

## Artifacts

- `qa.sh` — the full harness (sandbox, wiring, both cases, isolation sweep)
- `out/case1-run.txt` — CLI transcript of the positive case
- `out/case1-trace.ndjson` — full plugin trace (primary evidence)
- `out/case2-run.txt`, `out/case2-trace.ndjson` — negative case
