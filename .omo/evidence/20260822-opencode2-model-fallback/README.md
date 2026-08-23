# OpenCode2 Runtime Model Fallback QA Evidence

Date: 2026-08-23 | Branch: `feat/oc2-runtime-fallback` | Base: `origin/dev` at `0ecd048de`

## WHAT WAS TESTED

The OpenCode2 adapter now reacts to durable `session.execution.failed` events
for main sessions when the shared model-core classifier identifies provider
quota exhaustion. The runtime reads the active agent/model captured by the
context hook, resolves the next model from that agent's existing fallback
chain, calls `session.switchModel`, and queues a synthetic continuation through
the one plugin-wide session dispatch gate.

The following surfaces were exercised:

- `bun test packages/omo-opencode2/src` for the full adapter suite, including
  classifier wiring, non-exhaustion rejection, task-child exclusion, retry
  bounding and success reset, exhausted chains, shared-gate blocking, config
  defaults, `disabled_hooks`, and context-recorded agent/model fallback.
- `bun run typecheck` across the complete workspace.
- The TypeScript no-excuse audit across all nine changed TypeScript files.
- `qa.sh` against the real `opencode2` binary in isolated `XDG_*`, `HOME`, and
  `USERPROFILE` directories. A local mock OpenAI-compatible provider returned a
  deterministic HTTP 429 `insufficient_quota` response for both configured
  models, so the enabled path could be asserted without spending provider
  credits or depending on model temperament.
- Both live directions: enabled fallback must emit registration, trigger, and
  switch traces; `disabled_hooks: ["model_fallback"]` must emit the disabled
  trace and no trigger/switch traces under the same forced failure.
- Host-store isolation by exact read-only `session_v2` row counts before/after
  plus a newer-than-marker sweep of the real OpenCode stores.

## WHAT WAS OBSERVED

- Full adapter suite: `342 pass`, `0 fail`, `782 expect()` calls across 58
  files (`out/unit-green.txt`).
- Workspace typecheck: exit code 0 (`out/typecheck.txt`, summarized as PASS in
  `out/qa-summary.txt`).
- TypeScript audit: `No violations in 9 file(s)`
  (`out/no-excuse-audit.txt`).
- Real binary: `opencode2 v0.0.0-beta-17941` (`out/version.txt`). The adapter
  still compiles against its package pin `@opencode-ai/plugin@0.0.0-beta-17793`.
- Live QA tally: `PASS=12 FAIL=0` (`out/qa-summary.txt`).
- Enabled trace: one `omo.model-fallback.triggered` classified the error as
  `quota_exceeded`, with `currentModel=openai/gpt-5.6-sol`,
  `nextModel=zai-coding-plan/glm-5.2`, and `retry=1`
  (`out/trace-check-enabled-omo_model-fallback_triggered.json`).
- Enabled trace: one `omo.model-fallback.switched` confirmed the same model
  transition after the queued synthetic continuation was accepted
  (`out/trace-check-enabled-omo_model-fallback_switched.json`).
- Disabled trace: one `omo.model-fallback.disabled` with
  `reason=listed in disabled_hooks`; trigger and switch counts were both zero.
- Host `session_v2` count: `1135` before and `1135` after. The isolation sweep
  found no unexpected newer host-store files.

## WHY IT IS ENOUGH

The unit suite isolates every state-machine branch that is hard to drive
reliably through a model: only provider exhaustion is eligible, task-engine
children never enter this runtime, retries stop at the configured bound and
reset only after success, a concurrent observer holding the real shared gate
blocks fallback, and an absent next chain entry stops without redispatch. The
registration test also pins the live API nuance discovered during QA:
`Session.Info.agent` is absent and `Session.Info.model` may be absent, while the
context event reliably supplies both values for the failed turn.

The live enabled run drives the actual plugin source, real event subscription,
real durable execution failure, real `session.switchModel`, and real queued
synthetic call. The disabled run uses the identical failure stimulus and proves
the feature does not always fire. Exact host DB counts and the file sweep prove
the child process stayed in its sandbox.

## LIVE VERSUS UNIT PROOF

- **Proved live:** config loading, `disabled_hooks` precedence, event-pump
  registration, durable 429 execution-failure observation, shared classifier
  signal, active agent/model capture through the context hook, model switch,
  queued continuation acceptance, disabled absence, and host-store isolation.
- **Proved by unit test:** non-quota rejection, task-child exclusion, retry
  exhaustion and reset, fallback-chain exhaustion, shared-gate contention, and
  disposal/state cleanup.

## WHAT WAS OMITTED

- The fallback target was intentionally configured against the same local 429
  server, so QA does not claim the replacement model completed a successful
  answer. The feature's contract is the reactive switch plus queued redispatch;
  those calls are proven by trace, while successful provider output would test
  external credentials and model behavior instead of this adapter seam.
- The requested ZhipuAI key was read from the real v1 auth store and exported
  only into the isolated child environment. The mock providers used a literal
  `mock-key`, so the real key was never sent, printed, copied, or committed.
- Raw environment dumps, auth headers, provider credentials, and private config
  contents were not captured.
- The available real binary was beta-17941 rather than the adapter's beta-17793
  type pin. This is residual compatibility coverage in the conservative
  direction: compilation proves the pinned contract, while the live run proves
  the same source against the later installed binary. No unverified API was
  introduced.
