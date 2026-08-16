# OpenCode2 TodoWrite Tool + Todo-State Injection QA Evidence

Date: 2026-08-16 | Branch: `feat/oc2-todo-inject` | Base: `dev` at `a949cebd2`

## WHAT WAS TESTED

opencode2 ships no todo tool. OMO prompts (Atlas + 7 ultrawork variants)
instruct the model to call `TodoWrite([...])`, so on opencode2 the model was
directed at a tool that did not exist. This change:

1. Registers a `todowrite` tool that owns per-session todo state
   (`TodoStore`), matching the prompt-instructed shape `{id, content, status,
   priority}`.
2. Injects the current todo list into `event.system` on every request via the
   existing context composer (Step 4, between rules and keyword mode).
   Compaction survival is structural: the summarizer can drop whatever it
   wants from messages; the next request re-injects current state from the
   store anyway.
3. Subscribes to `session.deleted` to clean up the store.

The first QA run failed because the model wrapped the array in
`{"todos": "..."}` (JSON string) rather than sending a bare array. The tool
was fixed to accept an object with a `todos` property and to handle
string-encoded arrays. Tests were updated to cover this.

## WHAT WAS OBSERVED

`out/qa-summary.txt` ends with `summary: PASS=6 FAIL=0`.

- `out/trace-check-registered.txt`: `todowrite` appears in the
  `omo.orchestration.registered` tools array.
- `out/trace-check-executed.txt`: `omo.todo.write` trace event present with
  `count=2`, confirming the model called the tool and the store accepted the
  input.
- `out/trace-check-injected.txt`: at least one `omo.context.composed` event
  has `todoParts > 0`, confirming the todo state was injected into the system
  prompt after the tool call.
- `out/trace-check-no-executed.txt`: zero `omo.todo.write` events when the
  model was not asked to use the tool (negative direction).
- `out/trace-check-no-injected.txt`: zero `todoParts` in all
  `omo.context.composed` events when no todowrite call occurred (negative
  direction).
- `out/isolation-violations.txt`: empty. No writes to host OpenCode stores.

## WHY IT IS ENOUGH

Both directions are proven. The positive case shows the tool is registered,
callable by the model, and that state flows into the context composer. The
negative case shows no injection noise when the tool is unused. The assertions
read `OMO_SPIKE_TRACE` NDJSON, not the CLI transcript, which does not expose
raw system parts or tool results.

Unit coverage (16 tests across 3 files) covers store CRUD, session isolation,
input validation (including the string-encoded variant), injection shape,
replacement semantics, empty-state suppression, and compaction survival
(state re-injected after a simulated message clear).

## LIVE VERSUS UNIT PROOF

The live QA proves the tool is registered and callable by the real model on
the real binary, and that the context composer includes the injected state.
The unit tests cover the parsing edge cases (bare array, wrapped object,
string-encoded array) and the compaction-survival simulation. Together they
cover both the wiring and the semantics.

## WHAT WAS OMITTED

- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed.
- `models.json` is excluded from the host-store sweep: OpenCode2 owns that
  provider catalog and the plugin does not write it.
- The known Windows `spawn-with-timeout.test.ts` failure was not run or
  changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic
  review was awaited.
