# Todo continuation enforcer, QA evidence

Change: `packages/omo-opencode2` gains a second idle injector, the todo
continuation enforcer, and both it and goal are expressed as configurations of
a new shared `orchestration/idle-injector.ts`.

Harness: `qa.sh` in this directory. Real `opencode2` binary
(`0.0.0-next-17444`), isolated sandbox, live `zhipuai/glm-4.7`.

## What was tested

Two runs, because one is not enough.

**RUN A, enforcer alone (`goal.enabled=false`).** A session is told to write one
pending todo and stop. On the idle edge that follows, the enforcer must inject.

**RUN B, both injectors armed (`goal.enabled=true`).** A session is told to
create a goal AND write one pending todo, then stop. Both features now observe
the same idle edge and both would inject if each held its own gate.

RUN A exists specifically to keep RUN B honest. RUN B asserts "they did not both
inject", and an enforcer that never fires at all also never double-fires, so
without RUN A the interesting assertion would pass for the wrong reason.

## What was observed

`summary: PASS=8 FAIL=0`

| Check | Observed |
|---|---|
| a-plugin-loaded | trace non-empty, 157 lines |
| a-registered | `omo.todo.registered` x1 |
| a-enforcer-fires | `omo.todo.continuation-injected=1`, `event-error=0` |
| b-plugin-loaded | trace non-empty, 292 lines |
| b-both-armed | `omo.goal.registered=1`, `omo.todo.registered=1` |
| b-single-dispatch | `goal-injected=1 todo-injected=0` **sum=1** |
| b-no-pump-error | `omo.todo.event-error=0`, `omo.goal.event-error=0` |
| isolation | host `opencode.db` unchanged (absent to absent) |

The load-bearing number is RUN B's **sum=1**. Two independent features observed
one live idle edge; the shared gate admitted goal and blocked the enforcer, so
the session received exactly one continuation instead of two. RUN A's
`todo-injected=1` proves the blocked one is a working feature, not a dead one.

Artifacts: `out/run-todo-only.txt`, `out/run-both.txt` (CLI output),
`out/todo-events-a.ndjson`, `out/todo-events-b.ndjson` (filtered `omo.*` trace
events), `out/trace-tail.ndjson` (last 40 lines of RUN B).

## Why it is enough

This is the contention path PR-4 could only unit-test, because goal was then the
only idle injector. It is now driven end to end on the real binary with two real
features, which is the first time the shared-instance requirement is load
bearing in production rather than in a test double.

The unit suite covers what the binary cannot cheaply reach: both directions of
the shared-instance property (one gate admits one dispatch across two injectors,
two gates admit two), the settle-window re-checks, and the enforcer's budget
including its reset on progress. `bun test packages/omo-opencode2/src` is
216 pass / 0 fail, `bun run typecheck` exits 0.

## Residual risk

The budget (`max_consecutive`, default 12) is unit-tested but not driven on the
binary, since forcing a genuinely stuck model is slow and non-deterministic. The
failure mode if it is wrong is bounded in the safe direction: the budget only
ever stops continuations, it never causes an extra one.

RUN B proves at most one injection across two injectors on a bounded run. It does
not prove fairness between them, and it should not: which feature wins a given
edge is deliberately unspecified.

## A harness bug worth recording

The first execution reported `PASS=3 FAIL=5`, and three of those five failures
were the useful signal while two of the passes were fake. `run_case` echoed
progress to stdout, but stdout is the function's return channel under command
substitution, so the echoed line was captured into the trace path and every
trace read hit "No such file or directory". With zero events parsed,
`b-single-dispatch` and `b-no-pump-error` both PASSED, because "no double
injection" and "no pump errors" are trivially true of a run that never happened.

That is the same false-green shape PR-4 hit through a different cause, and the
anti-vacuity guard (`plugin-loaded`, asserting the trace is non-empty) is what
made it visible instead of shipping as a green run. Keep that guard in every
harness that asserts on the absence of something.

## What was omitted

No raw full traces and no model catalog dumps are committed. They are large and
carry provider model ids that the repo-wide legacy-model audit scans for. Only
filtered `omo.*` event files, a 40-line tail, and the CLI output are kept. No
credentials appear in any artifact; the API key is read from the host auth store
into the child environment and never written to disk.
