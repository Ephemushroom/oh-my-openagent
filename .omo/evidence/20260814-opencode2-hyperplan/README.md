# OpenCode2 Hyperplan Keyword QA Evidence

Date: 2026-08-14 | Branch: `feat/opencode2-hyperplan` | Base:
`dev` at `31799213b`

## WHAT WAS TESTED

The implementation was derived from the v1 source in
`packages/omo-opencode/src/hooks/keyword-detector/`. V1's exact combination
rule is strict adjacency in either order: `hyperplan|hpp` immediately followed
by `ultrawork|ulw`, or the reverse. When that combination matches, v1
suppresses both standalone injections and emits one
`<hyperplan-ultrawork-mode>` banner followed by exactly one model-routed
ultrawork prompt. If the two keywords are non-adjacent, the combo does not fire
and both standalone modes inject.

- TDD red: `out/unit-red.txt` captures 5 existing passes and 4 expected
  failures before implementation. The failures are the missing standalone
  hyperplan, forward combo, reverse combo, and non-adjacent dual-mode behavior.
- Unit green: `out/unit-green-focused.txt` captures the focused context
  composer suite. `out/unit-green.txt` captures
  `bun test packages/omo-opencode2/src` at 89 pass and 0 fail.
- Type safety: `out/package-typecheck.txt` captures the package check and
  `out/typecheck.txt` captures `bun run typecheck` across the repository with
  exit code 0.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` with
  `zhipuai/glm-4.7` in isolated XDG, HOME, and USERPROFILE directories. It ran
  standalone hyperplan, adjacent hyperplan plus ultrawork, and a no-keyword
  negative case.
- Isolation: `qa.sh` created a marker before the sessions and swept the real
  OpenCode data, config, cache, and state stores for newer files.

## WHAT WAS OBSERVED

- `out/qa-summary.txt`: `summary: PASS=7 FAIL=0`.
- Standalone hyperplan: `out/trace-check-hyperplan.txt` observed three real
  `omo.context.composed` events and matched structural counts
  `ultraworkParts=0`, `hyperplanParts=1`,
  `hyperplanUltraworkParts=0`. `out/run-hyperplan.txt` begins the model reply
  with `HYPERPLAN MODE ENABLED!`.
- Adjacent combination: `out/trace-check-combo.txt` observed four real
  composed events and matched `ultraworkParts=1`, `hyperplanParts=0`,
  `hyperplanUltraworkParts=1`. This proves standalone hyperplan was suppressed
  and the combo embeds one routed ultrawork prompt. `out/run-combo.txt` begins
  with the combo banner and does not emit either standalone banner.
- Negative case: `out/trace-check-negative.txt` matched all three counts at
  zero, while `out/run-negative.txt` contains the ordinary `ok` reply.
- `out/isolation-violations.txt` is empty. The newer-than-marker sweep found no
  writes in the host OpenCode stores.
- Raw structural traces are retained as `out/trace-hyperplan.ndjson`,
  `out/trace-combo.ndjson`, and `out/trace-negative.ndjson`.

## WHY IT IS ENOUGH

The pure detector tests pin whole-word hyperplan and `hpp`, the `.hpp` file
extension exclusion, strict adjacency in both orders, combo suppression,
non-adjacent standalone stacking, structural prompt tags, and idempotency. The
composer tests prove those decisions flow through the one existing OpenCode2
context hook rather than a parallel detector.

The real binary then exercised that same hook before real model requests. The
trace count assertions distinguish all three requested outcomes without
depending on model prose, while the captured replies independently show the
model received the standalone and combo directives. The negative trace rules
out an always-on detector. The empty isolation sweep demonstrates that all
session state remained inside the sandbox.

## WHAT WAS OMITTED

- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed. No environment
  dump or auth-store content is present in the artifacts.
- The hyperplan skill and team tools are not registered in the current
  OpenCode2 adapter. The live model therefore attempted the injected skill load
  and reported that it was unavailable. Skill and command registration is a
  separate in-flight parity slice; this PR proves keyword detection and prompt
  injection only.
- The known Windows `spawn-with-timeout.test.ts` failure was not run or changed.
  The required OpenCode2 package suite and repository typecheck are clean.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  will be awaited.
