# Evidence: OpenCode 2 port — Phase 1 (agents-core extraction + agent/category registration)

Date: 2026-08-11. Plan: `.omo/plans/opencode2-port.md` (Phase 1).
Branch: `feat/opencode2-phase1-agents` (9 commits over `dev` @ 06ecffc0a).

Phase 1 has two halves, each verified independently.

## Part A — `packages/agents-core` extraction (pure move + re-export)

The 7 inline prompt families and the shared model-family predicates/types were moved
out of `packages/omo-opencode/src/agents/` into a new harness-neutral package
`packages/agents-core/`, so the same prompt builders drive both the v1 adapter and
the new v2 adapter.

- Moved (`git mv`, byte-for-byte prompt text preserved): `dynamic-agent-*` section
  builders, `gpt-apply-patch-guard` / `gpt-prompt-identity`, `kimi-tool-loop-guard`,
  `builtin-agents/resolve-file-uri`, the `sisyphus/**` (12 model-family builders) +
  `sisyphus-dynamic-prompt*` + `sisyphus-gemini-fallback-overrides` family, the
  `sisyphus-junior/**` builders + pure prompt router, the `hephaestus/**` GPT
  builders + pure prompt router, and the specialist prompt constants/selection
  helpers (oracle / librarian / explore / metis / momus / momus-gpt-5-6 /
  multimodal-looker) under `specialists/`.
- Split: `types.ts` (pure types + predicates → agents-core; harness-coupled
  `AgentFactory` / `AgentOverrideConfig` stay in v1) and the specialist files (pure
  prompt consts + metadata + per-model prompt selection → agents-core; the
  `@opencode-ai`-coupled factories stay in v1).
- v1 keeps one-line `export * from "@oh-my-opencode/agents-core/..."` shims at every
  old path, so no v1 import site changed.
- agents-core carries an `opencode-coupling-audit` test asserting no `@opencode-ai`
  import anywhere in the package.

One latent bug surfaced and fixed by the move: `resolve-file-uri.ts` captured its
allowed-home subdirectories at module-eval time, which raced the test harness's
hermetic-HOME preload once agents-core's barrel re-exported it during preload. The
allow-list is now resolved lazily per call (production behavior unchanged).

### Part A verification

- `bun test packages/omo-opencode/src/agents` → 371 pass / 0 fail (matches the 391
  baseline minus the resolve-file-uri (11) and kimi-tool-loop-guard (2) suites that
  moved to agents-core, plus their new home in `packages/agents-core/test`).
- `bun run typecheck:packages` → all packages green including the new agents-core.
- Full omo-opencode suite failures are the pre-existing non-deterministic upstream
  flaky set (verified identical on a clean `dev` worktree with a fresh install);
  the extraction introduces zero new deterministic failures.

## Part B — omo-opencode2 agent + category registration

`packages/omo-opencode2` now registers the real OMO agent catalog against the live
v2 catalog: 4 primaries (sisyphus / hephaestus / prometheus / atlas), 7 subagents
(oracle / librarian / explore / multimodal-looker / metis / momus / sisyphus-junior),
and 8 delegation categories, each upserted via `ctx.agent.transform` with its
agents-core prompt, description, mode, permission ruleset, and a model resolved
through `@oh-my-opencode/model-core`'s pure pipeline. Default agent = sisyphus; the
built-in `build` agent is downgraded to a hidden subagent. The Phase 0 mechanics
probe (omo-spike echo/delegate/context tools) is gated behind `OMO_SPIKE_MECHANICS=1`
so production registration owns the default; the recorded Phase 0 driver sets that
flag to stay reproducible.

### Part B verification

Unit (`packages/omo-opencode2/src/agents/register.test.ts`, mock Context, no binary):
12 pass / 0 fail covering model resolution (chain match / system-default fallback /
cold-catalog first-fallback), subagent + primary + category registration shape,
permission rulesets, the `sisyphus` default, the `build` downgrade, and the
Hephaestus GPT-only + `requiresProvider` gates (v1 parity).

Real opencode2 (`@opencode-ai/cli` 0.0.0-next-17055, windows-x64 binary run directly —
the npm launcher shim is broken on this host, Phase 0 finding F1):
`bash .omo/evidence/20260811-opencode2-phase1/qa.sh`. PASS=26 FAIL=0
(out/trace.ndjson, out/run-default.txt, out/run-subagent.txt). Model: zhipuai/glm-4.7.

1. **Registration mechanism (deterministic, plugin trace).** `omo.registration.complete`
   lists all 4 primaries + 7 subagents + 8 categories; per-agent
   `omo.agent.registered` / `omo.category.registered` events carry the resolved model,
   variant, and baked system-prompt length; `omo.agent.default` = sisyphus;
   `omo.agent.build-downgraded` fired.
2. **Default agent (behavioral).** A run with no `--agent` shows the header
   `> sisyphus · glm-4.7` and executes (out/run-default.txt).
3. **Model resolution wired to model-core.** Every registered agent carries a
   `provider/model` ref and a non-empty system prompt (trace `systemLength` > 0).
4. **Subagent dispatch (behavioral).** Prompting the default agent to use the native
   v2 `subagent` tool with `agent=oracle` dispatched to the registered subagent (the
   tool resolved and invoked it), proving the registered subagent is dispatchable by
   name. See the finding below for why the child run itself did not complete.
5. **Isolation.** v2 wrote only inside the sandbox; no new files in the real
   `~/.local/share/opencode` or `~/.config/opencode` (out/isolation-violations.txt is
   empty).

## Findings (feed back into the port plan)

- **P1-F1 (fixed in-branch): the v2 catalog is empty at plugin setup.** `catalog.snapshot`
  at setup reported `availableModels=0`; the catalog populates on `catalog.updated`
  (~480 ms later), and agent.transform callbacks run lazily on first registry
  materialization. First cut snapshotted at setup and computed result lists at return
  time, so agents resolved onto first-fallback models and `omo.registration.complete`
  traced empty arrays. Fix (`2f31cbb1a`): a `CatalogSource` captured inside a
  `catalog.transform` callback (re-fires on updates), model resolution read from
  `catalog.current` inside the agent.transform callback, and result sets read after
  `ctx.agent.reload()`. Post-fix trace: `availableModels=6215`, registration summary
  fully populated.
- **P1-F2 (open): the v2 catalog is the full models.dev universe, not the
  authenticated set.** `catalog.snapshot` listed 6215 models across ~200 providers on
  a box where only `zhipuai` is authenticated. model-core therefore resolves agents
  to chain-preferred but un-runnable models (e.g. oracle → `openai/gpt-5.6-sol`), and
  the dispatched subagent failed at runtime with `Model unavailable`. The v1 adapter
  avoids this by resolving over connected (authenticated) providers only; the
  published `@opencode-ai/plugin@0.0.0-next-17055` Promise API exposes no
  per-provider authentication/connection signal on `catalog`/`provider`/`client`
  (the only credential surface, `integration.connection.active`, is keyed by
  integration id, not provider). Recorded as a new risk in the plan's register
  (auth-aware filtering deferred until v2 exposes a connectivity API). On a fully
  configured box this resolves correctly.

## Why this is enough for Phase 1

Phase 1 acceptance (plan §9) is "agents registered + categories + model-core wired,
each agent runs in a real session with its model/permissions/prompt". The extraction
is proven non-regressive for v1; the registration is proven by deterministic trace
events plus a behavioral default run plus a native subagent dispatch. Residual risk
is concentrated in P1-F2 (model runnability on partially-authenticated boxes), which
is an environment/capability gap, not a registration defect.

## What was omitted

- The provider API key was read from the real v1 auth store into the child process
  environment only; never printed or persisted. Evidence files were produced inside a
  throwaway sandbox.
- Subagent *output* on this box is not asserted: no subagent's fallback chain includes
  the single authenticated provider (zhipuai), so a child run cannot complete here.
  Dispatch is proven; runnable-model resolution is P1-F2.
