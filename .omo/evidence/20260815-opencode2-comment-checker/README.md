# OpenCode2 Comment Checker QA Evidence

Date: 2026-08-15 | Branch: `feat/oc2-comment-checker` | Base: `dev` at `b54e1451f`

## WHAT WAS TESTED

The OpenCode2 adapter now registers a v2 `execute.after` comment checker for
successful `write`, `edit`, `multiedit`, and `apply_patch` calls. It translates
v2 events into `@oh-my-opencode/comment-checker-core` inputs, appends checker
feedback to the tool result seen by the model, emits a distinct
`omo.comment-checker.detected` trace, and becomes inert when the optional native
binary cannot be resolved.

Verification covered:

- TDD RED: `out/tdd-red.txt` records `0 pass`, `1 fail`, and `1 error` because
  the new adapter module did not exist.
- TDD GREEN: `out/tdd-green.txt` records `8 pass`, `0 fail`, and `20 expect()`
  calls after the implementation landed.
- Package gate: `bun test packages/omo-opencode2/src` records `122 pass`,
  `0 fail`, and `349 expect()` calls in `out/unit-tests.txt`.
- Type safety: `bun run typecheck` exited `0`; the full workspace command chain
  is captured in `out/typecheck.txt`.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` version
  `0.0.0-next-17055` with `zhipuai/glm-4.7` inside isolated `XDG_*`, `HOME`, and
  `USERPROFILE` stores.

## WHAT WAS OBSERVED

`out/qa-summary.txt` ends with `summary: PASS=7 FAIL=0`.

- Registration: the live plugin emitted `omo.comment-checker.registered`.
- Clean direction: a real model-created `clean.ts` traversed the completed
  post-tool path and emitted one `omo.comment-checker.checked` event with
  `outcome=clean`; `omo.comment-checker.detected` was absent.
- Detection direction: the model complied on the first and only slop attempt.
  The write of `// This function adds two numbers` emitted exactly one distinct
  `omo.comment-checker.detected` event with `outcome=detected` and a non-empty
  checker message (`messageLength=2370`). `out/slop-live-outcome.txt` records
  `LIVE_DETECTION_PROVED`.
- Isolation: `out/isolation-violations.txt` is empty. The newer-than-marker sweep
  found no writes to the host OpenCode stores.
- Degraded mode: unit coverage resolves the optional binary once, makes two
  completed writes inert, never calls the runner, and leaves both results
  unchanged.
- Escape hatches: unit coverage forwards both `// @allow` and top-of-file
  `// comment-checker-disable-file` content unchanged to the checker and honors
  its clean result without injecting feedback or a detection trace.

## WHY IT IS ENOUGH

The live assertions inspect `OMO_SPIKE_TRACE` rather than CLI prose. The CLI
summarizes tool activity, while these trace events are emitted from the exact
`execute.after` hook that runs the checker and mutates the tool result.

Both behavioral directions are live-proven. The clean case rejects an
implementation that always fires, while the slop case rejects a registered but
inert checker. The package suite then covers the branches that are unsafe or
unreliable to force through model temperament: both v1 escape markers, string
and content-array feedback shapes, edit field mapping, apply-patch extraction,
failed and non-mutation tools, and missing-binary degradation.

The adapter does not copy checker logic. It reuses the core parser, resolver,
runner, timeout, process-exit, and failure contracts. The runtime shim only
adapts Bun spawning and the package's optional `getBinaryPath()` API to the
core interfaces.

## LIVE VERSUS UNIT PROOF

Live proof:

- Plugin registration on the pinned OpenCode2 binary.
- Successful write reaching `execute.after`.
- Clean write producing `checked=clean` and no detection.
- Slop write producing the distinct detection trace on the first attempt.
- Host-store isolation.

Unit-only proof:

- `// @allow` and `// comment-checker-disable-file` are forwarded unchanged and
  suppress feedback when the checker accepts them.
- Optional-binary absence disables checking without throwing or mutating output.
- `edit`, `multiedit`, and `apply_patch` payload translation.
- Array-shaped result feedback and failed/non-mutation filtering.

## WHAT WAS OMITTED

- No model retry loop was used. The model wrote the requested slop on the first
  attempt, so the live detection branch was proven directly. Had it refused or
  self-corrected, `qa.sh` would have recorded that and retained unit-only
  detection proof rather than retrying until compliance.
- Escape markers were not forced through a model prompt. Model compliance with
  deliberately exempted comments is temperament, not adapter behavior; the
  unit seam proves the exact payload and checker outcome deterministically.
- CLI transcripts are retained as `out/run-clean.txt` and `out/run-slop.txt`,
  but they are not used as hook proof.
- The ZhipuAI key was read from the v1 auth store into the isolated child
  environment only. It was never printed, copied, or committed.
- The known Windows `spawn-with-timeout.test.ts` failure was not run or changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
