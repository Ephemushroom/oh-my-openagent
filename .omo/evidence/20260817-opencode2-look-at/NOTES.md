# QA evidence: opencode2 `look_at` capability gate

Date 2026-08-17. Branch `feat/oc2-look-at`. Base `dev@bd0c80441`.
Binary `0.0.0-next-17444`. Harness `qa.sh`, raw artifacts in `out/`.

## What was tested

`look_at` routes on the CALLER's vision capability instead of always delegating.
Three outcomes must be reachable, and the two live ones must both be driven
against the real binary:

1. `registered` the tool reaches core's tool registry.
2. `delegated` a caller WITHOUT image input routes to a vision-capable model.
3. `passthrough` a caller WITH image input is told to use `read` instead.
4. `isolation` no writes land in the host opencode/codex stores.

Driven with `opencode2 run --standalone --auto` in a `mktemp` sandbox (own
`XDG_*`, `HOME`, `USERPROFILE`, `OPENCODE_TEST_HOME`), plugin loaded from TS
source. Assertions read `OMO_SPIKE_TRACE` NDJSON, not model prose, because prose
is flaky and a session can invoke a tool yet emit no final text.

The caller model is set per case through `opencode.jsonc` plus the
`[opencode2]` block, so the gate sees a genuinely different session model in
each direction rather than a stubbed value.

## What was observed

Final run: **PASS=4 FAIL=0**.

| Case | Evidence |
|---|---|
| registered | `{"event":"omo.lookat.tool-registered","tool":"look_at"}` |
| delegated | `{"event":"omo.lookat.delegated","model":"zhipuai/glm-4.7","visionModel":"zhipuai/glm-4.5v","files":1}` |
| passthrough | `{"event":"omo.lookat.passthrough","model":"zhipuai/glm-5v-turbo","files":1}` |
| isolation | host-store sha1 identical before and after |

Both directions fired from real sessions on different models, so the gate is
proven to branch rather than to constantly return one answer.

End-to-end, not just routing:

- Delegate run: `glm-4.7` (blind) called `look_at`, the child on `glm-4.5v`
  examined the file, and the session answered "The image is a solid
  pink/salmon color with no other elements."
- Passthrough run: `glm-5v-turbo` (sighted) called `look_at`, was told to use
  `read`, then actually called `read probe.png` and described the same image.

The two paths reached the same visual conclusion about the same file through
different mechanisms, which cross-checks the delegation result.

## A real bug this QA caught

The first run passed all four checks yet the delegated child FAILED with a
provider routing error. Routing fired; the work did not happen.

Cause: `visionModels` is built from every model the catalog lists, and v2's
catalog lists models from roughly 200 providers regardless of whether the user
holds credentials for them. Preferring the multimodal-looker fallback chain
therefore selected `openai/gpt-5.6-sol`, which this account cannot call, while
the usable `zhipuai/glm-4.5v` sat in the same catalog.

Fix: `selectVisionModel` now prefers a vision model from the CALLER's own
provider, which is the one provider proven to authenticate, before consulting
the chain. Re-run picked `zhipuai/glm-4.5v` and the child returned content.
Pinned by two unit tests in `vision-gate.test.ts` (caller provider beats the
chain; chain still applies when the caller's provider has no vision model).

This is why the trace-only assertion was not sufficient on its own and the run
transcripts were read as well.

## Why it is enough

The gate's entire contract is which of three branches it takes. Both live
branches were driven on the real binary with real models and asserted from
first-party trace output, and the resulting work was confirmed to complete in
both. The third branch (`unavailable`) is not reachable on an account whose
catalog contains vision models, so it is covered by unit tests for both of its
reasons (`no-vision-model`, `catalog-cold`).

Unit gates: `bun test packages/omo-opencode2/src` 191 pass / 0 fail (164 on
base, 27 added). `bun run typecheck` exit 0.

## Residual risk

- `unavailable` was not driven live, only unit tested.
- Provider preference is a heuristic: a caller whose provider has a vision model
  of poor quality now beats a better chain model. Chosen deliberately, because
  an uncallable better model is worth less than a callable adequate one.
- v1's base64 `image_data` surface is not ported. Local file paths only.

## What was omitted

No API keys, auth headers, or env dumps are recorded. `ZHIPU_API_KEY` is read
from the host auth store at run time and passed to the child process only; it
never appears in `out/`. The catalog trace in `out/catalog.json` lists public
model identifiers only.
