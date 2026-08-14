# OpenCode2 Delegate Retry QA Evidence

Date: 2026-08-14 | Branch: `feat/oc2-delegate-retry` | Base: `dev` at `3bb99a91f`

## WHAT WAS TESTED

The OpenCode2 adapter now applies the two v1 delegated-task result policies in
the existing `task` orchestration path:

- Empty or whitespace-only child output becomes the v1 actionable empty-response
  warning instead of a passive no-text sentence.
- Recognized task invocation failures are detected by
  `@oh-my-opencode/delegate-core` and receive its corrective retry guidance.
- Normal non-empty output remains byte-for-byte unchanged.
- Foreground and continuation returns use the guidance seam directly.
- Background terminal output is guided before the parent synthetic callback and
  before later retrieval from the task registry.
- Every detection emits `omo.task.unusable-output-detected` with either
  `reason=empty_response` or `reason=retryable_error` plus the core error type.

Verification commands and surfaces:

- TDD RED: targeted tests against a no-op result seam, captured in
  `out/unit-red.txt`.
- Targeted GREEN: `bun test` for the result and background-engine guidance tests,
  captured in `out/unit-target-green.txt`.
- Adapter gate: `bun test packages/omo-opencode2/src`, captured in
  `out/unit-green.txt`.
- Type gate: `bun run typecheck`, captured with its exit code in
  `out/typecheck.txt`.
- Static rules: the TypeScript no-excuse audit across all five changed TypeScript
  files, captured in `out/no-excuse-audit.txt`.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` with
  `zhipuai/glm-4.7` in isolated `XDG_*`, `HOME`, and `USERPROFILE` directories.
  Assertions use `OMO_SPIKE_TRACE` NDJSON, not the CLI transcript.

## WHAT WAS OBSERVED

- RED was behavior-level: `1 pass, 2 fail`. Empty and retryable-error cases both
  returned `kind=usable` before implementation; the normal case already passed.
- Targeted GREEN: `4 pass, 0 fail`, including an empty background child whose
  parent callback and registry both receive guidance.
- Full OpenCode2 source suite: `110 pass, 0 fail`, `318 expect()` calls across
  22 files.
- Root typecheck: `exit_code=0`.
- TypeScript no-excuse audit: `No violations in 5 file(s)`.
- Real surface: `summary: PASS=6 FAIL=0` in `out/qa-summary.txt`.
- Live trace analysis in `out/trace-analysis.json` reports task registration,
  a routed `explore` child on `zhipuai/glm-4.7`, successful non-empty completion,
  and zero `omo.task.unusable-output-detected` events.
- `out/isolation-violations.txt` is empty.

## WHY IT IS ENOUGH

The deterministic unit tests prove both detection directions and the negative
control: whitespace-only output triggers actionable guidance and its trace,
recognized delegate-core failures trigger retry guidance and their trace, and
normal output is preserved exactly with no trace. The background-engine test
also proves that an empty asynchronous child result reaches the parent callback
and registry as guidance rather than an empty string.

The live run proves the real plugin setup registers the existing `task` tool,
the model actually invokes that tool, the child runs through the real task engine
and finishes with non-empty output, and the new detector does not fire on the
normal path. This prevents a detector that always fires from passing. The host
store sweep proves the real-surface run stayed isolated.

## LIVE VERSUS UNIT PROOF

- **Proved live:** plugin and `task` registration, foreground `task` routing to a
  real `explore` child, successful non-empty child completion, no false-positive
  detection trace, and no host-store writes.
- **Proved by unit test only:** deterministic whitespace-empty detection,
  delegate-core retryable-error detection and appended guidance, the two trace
  reason payloads, exact preservation of normal output, and propagation of empty
  background output into the parent callback and registry.

## WHAT WAS OMITTED

- A genuinely empty live model response was not forced. The live model is not a
  deterministic empty-output fixture, and retrying until it happened would test
  model temperament rather than adapter behavior. The detection branch is
  isolated by unit tests; the live test covers registration and the negative
  direction as requested.
- The CLI transcript was retained as `out/run-normal.txt` for reviewer context,
  but no behavioral assertion depends on it. Assertions use trace records.
- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed.
- Raw environment dumps, auth headers, provider responses, and sandbox contents
  were not captured.
- LSP diagnostics were attempted twice, but the local LSP daemon remained
  unreachable at its Windows named pipe. Root `tsgo` typecheck passed across all
  packages, and the changed-file no-excuse audit passed. No LSP installation or
  host configuration was changed.
- `task-tool.ts` is at 242 pure LOC, within the repository limit but in the
  200-250 warning band. A future edit should split its validation and execution
  responsibilities before adding more logic.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
