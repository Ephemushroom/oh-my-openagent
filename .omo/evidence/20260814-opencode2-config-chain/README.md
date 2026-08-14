# QA Evidence: omo-opencode2 config chain integration

Date: 2026-08-14 | Branch: `feat/opencode2-config-chain` | Base: `dev` @ 6f394d267

> Rebased from `a83b0ecc6` onto `6f394d267` after the hashline (#12) and
> installer plugin-entry (#13) PRs merged. Both this branch and #12 modify the
> `setup()` composition in `src/index.ts`; the rebase applied cleanly and the
> result carries both the hashline registrations and the config wiring. The
> live QA below was RE-RUN against the rebased tree, not carried over.

## Scope

User direction (2026-08-14): Wire the unified OMO configuration chain into the OpenCode2 adapter (`packages/omo-opencode2/`), consuming `omo-config-core`. Introduce the `[opencode2]` harness block to separate v2 features from v1. The config should apply to `default_agent` and per-agent model overrides.

## What was tested

### Unit gate (hermetic, `bun test`)

`packages/omo-opencode2`: **75 pass / 0 fail** on the rebased tree (62 before the
rebase; the increase is the hashline suite arriving from `dev` via #12).
`packages/omo-config-core`: **15 pass / 0 fail**.
`bun run typecheck`: exit code 0 on the rebased tree.

- `omo-config-core/src/schema/config-schema.test.ts` — verified `[opencode2]` parses correctly.
- `omo-config-core/src/loader/loader.test.ts` — verified `[opencode2]` overrides flow through the chain.
- `omo-opencode2/src/config/schema.test.ts` — verified permissive adapter schema validation (stripping unknowns but catching malformed types).
- `omo-opencode2/src/config/loader.test.ts` — precedence order (base<user<proj<[opencode2]<proj[opencode2]<options), missing file tolerance, diagnostic aggregation, and user-only key protection (`mcp_env_allowlist`, `playwright_mcp_args`).
- `omo-opencode2/src/agents/register.test.ts` — agent override propagation and `default_agent` substitution.

### Real-surface QA (isolated sandbox, real opencode2 binary)

`bash .omo/evidence/20260814-opencode2-config-chain/qa.sh` — **PASS=9 FAIL=0**
(`out/`: `run-no-config.txt`, `run-with-config.txt`, `trace.ndjson`, `isolation-violations.txt`). Model `zhipuai/glm-4.7`, binary `opencode2 v0.0.0-next-17055` (windows-x64), isolated XDG/HOME.

1. **`config.fallback` / `config.default_agent.fallback` / `config.agent.registration` / `config.session.works` (C5)**: missing config runs without crashing, gracefully falling back to defaults (sisyphus). Session operates normally.
2. **`config.load.success` / `config.effective.default_agent` / `config.default_agent.override` (C3)**: config loads successfully without diagnostics. The `[opencode2].default_agent` override sets `hephaestus`, verifiable in trace.
3. **`config.model.override` (C4)**: per-agent model override for `oracle` flows through to the `omo.agent.registered` trace correctly (`openai/gpt-4o`).
4. **`isolation.clean`**: find-newer scan confirms no v2 writes leaked into the real opencode stores.

## Why this is enough

- The unit tests verify the exact mechanics of the merge hierarchy across multiple layers and scopes.
- The `omo-config-core` change is additive-only and isolated from `resolveOmoConfigView`'s control keys via explicit omission, meaning v1's execution path is undisturbed.
- The isolated real-binary QA demonstrates that the configuration values parsed by the adapter are actually consumed at runtime to drive framework behavior (agent selection and model resolution).
- Failing gracefully (C5) ensures typoed config doesn't brick the plugin.

## What was omitted

- Goal configuration and disabled hooks logic are parsed into the final configuration object but not yet consumed (feature gates out of scope for this PR, left for subsequent integration).
- `mcp_env_allowlist` and `playwright_mcp_args` logic are actively protected at the loader tier but have no active v2 consumers.
- No real tokens/secrets were committed; all API keys are restricted to the throwaway child environment.
