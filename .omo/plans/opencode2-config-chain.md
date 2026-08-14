# Plan: Wire the OMO unified config chain into the OpenCode2 adapter

Branch: `feat/opencode2-config-chain` (worktree). Base: `origin/dev` @ a83b0ecc6.
Scope: config chain + two consumption points (default agent, per-agent model override). Nothing else.

## Design decisions

- New harness block is `[opencode2]` (design doc 5.I), NOT reused `[opencode]`.
- `omo-config-core` change is additive-only: add optional `[opencode2]` key to the three
  schema objects (`OmoConfigSchema`, `OmoConfigLayerSchema`, `OmoConfigProfileSchema`) as the
  same freeform `z.record(z.string(), z.unknown())` used for `[opencode]`, and add
  `[opencode2]` to `stripResolutionControlKeys`. This does not alter v1 (v1 reads only
  `[opencode]`; it never had `[opencode2]`). Without the schema key, strict layer validation
  drops any layer that contains an `[opencode2]` block, so the key is required for the loader.
- Adapter does its own view building from `loadOmoConfig(...).layers` (mirrors v1
  `omo-config-chain.ts`), so core harness resolution (`HARNESS_IDS`) is untouched.

## Precedence implemented (lowest to highest)

`defaults < base(user) < base(project) < [opencode2] block (user then project) < profile base < profile [opencode2] < ctx.options`

Summarized to the task's contract: `defaults < user layer < project layer < harness block < ctx.options`.
View order (each later view overrides via `mergeOmoConfigRecords`):
1. base(non-control keys) per layer, user-first then project (nearest project last)
2. `[opencode2]` block per layer, same order
3. profile base per layer
4. profile `[opencode2]` block per layer
5. `ctx.options` (highest)

## Security invariant

`mcp_env_allowlist` and `browser_automation_engine.playwright_mcp_args` are USER-LAYER ONLY.
After the full merge, overwrite those two keys with the value computed from user-scope layers
only (base(user) + block(user) + profile(user)). `ctx.options` is project-scoped and cannot set them.

## Fail behavior

- Missing file: `loadOmoConfig` yields no layers -> defaults; never throws.
- Malformed JSONC: `loadOmoConfig` surfaces a `parse` diagnostic and skips the layer -> defaults
  survive; plugin setup never crashes. Adapter surfaces these diagnostics in its result.
- Merged parse failure: return defaults + a `validation` diagnostic (no throw). The whole load is
  wrapped so an unexpected internal error degrades to defaults + diagnostic.

## Trace event (stable shape for later PRs)

`omo.config.loaded` with detail:
`{ defaultAgent: string | null, agentModelOverrides: string[], goalEnabled: boolean, disabledHooks: string[], diagnostics: number, optionsApplied: boolean }`

## Files

New (adapter):
- `packages/omo-opencode2/src/config/schema.ts` — `OpenCode2ConfigSchema` + types
- `packages/omo-opencode2/src/config/loader.ts` — `loadOpenCode2Config`
- `packages/omo-opencode2/src/config/index.ts` — barrel
- `packages/omo-opencode2/src/config/schema.test.ts`
- `packages/omo-opencode2/src/config/loader.test.ts`

Modified:
- `packages/omo-config-core/src/schema/config.ts` — add `[opencode2]` to 3 schemas
- `packages/omo-config-core/src/loader/loader.ts` — strip `[opencode2]`
- `packages/omo-config-core/src/schema/config-schema.test.ts` — accept `[opencode2]` (RED first)
- `packages/omo-opencode2/package.json` — add `@oh-my-opencode/omo-config-core: workspace:*`
- `packages/omo-opencode2/src/index.ts` — load config, emit `omo.config.loaded`, consume
- `packages/omo-opencode2/src/agents/register-primaries.ts` — accept `agentOverrides`, consume model
- `packages/omo-opencode2/src/agents/register-subagents.ts` — same
- `packages/omo-opencode2/src/agents/register-categories.ts` — same
- `packages/omo-opencode2/src/agents/register.test.ts` — override precedence tests

## Consumption points (proven)

1. Default agent: `registerPrimaries` `draft.default(config.default_agent ?? "sisyphus")` (index passes it).
2. Per-agent model override: `agentOverrides[id].model` replaces the chain-resolved model in all
   three register functions.

## QA

- Unit RED->GREEN: `bun test packages/omo-opencode2/src` and the two core tests.
- `bun run typecheck`.
- LIVE QA (`.omo/evidence/20260814-opencode2-config-chain/qa.sh`): real opencode2 binary, isolated
  sandbox, `zhipuai/glm-4.7`. Prove: (C3) `[opencode2].default_agent` override observable in trace
  + transcript, then removal returns default; (C4) per-agent model override reaches the child/agent
  model in the trace `omo.agent.registered`; (C5) no-config still registers agents + runs a session;
  isolation proven by find-newer against real stores. Emit PASS/FAIL, exit non-zero on failure.
