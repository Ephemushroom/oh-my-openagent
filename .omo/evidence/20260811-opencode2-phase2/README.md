# Evidence: OpenCode 2 port — Phase 2 (orchestration)

Date: 2026-08-11. Plan: `.omo/plans/opencode2-port.md` (Phase 2, §6.3).
Branch: `feat/opencode2-phase2-orchestration` (over `dev` @ fc4a93ed8).

## What was tested

The orchestration layer of the omo → OpenCode 2 port: the `task` delegation tool
(sync / background / continuation), the `background_output` / `background_cancel`
tools, and the task engine that drives them (session-event pump → task records →
background completion notification to the parent session).

New modules in `packages/omo-opencode2/src/orchestration/`:

- `task-registry.ts` — background task records (status / aggregated texts /
  error / parent + child session ids) with create/get/list/output/cancel.
- `concurrency.ts` — per-`<provider>/<model>` concurrency limiter (default 5,
  FIFO queueing), mirroring v1's background-agent semantics.
- `task-engine.ts` — always-on event pump: routes child-session events
  (text.ended / reasoning.ended → aggregation; execution.succeeded / failed /
  interrupted / idle → task terminal state) and fires
  `onBackgroundTerminal` for background tasks (the plugin sends a synthetic
  wake to the parent session).
- `child-session.ts` — `runChildSession`: acquire slot → create/continue child
  → prompt → wait for a terminal execution event → release slot. Sync mode
  returns the aggregated output; background mode registers the task and returns
  immediately. `task_id` continuation reuses the same child session. On
  execution failure the child is recreated on the next fallback-chain model
  once.
- `task-tool.ts` — `task` tool: `category` / `subagent_type` routing, explicit
  `model` override, `load_skills`, `run_in_background`, `task_id`
  continuation, `command`.
- `background-tools.ts` — `background_output` (retrieve task output) and
  `background_cancel` (cancel + interrupt child session).

`index.ts` setup now assembles the engine + registry + limiter, wires the
`waitChild` deps, and registers the three tools (`codemode: false`).

## What was observed

Unit (`packages/omo-opencode2/src/orchestration/orchestration.test.ts`, no
binary): 8 new tests (registry lifecycle/aggregation/status, concurrency
queueing and per-key isolation, fallback-chain next-model resolution), bringing
the omo-opencode2 suite to 20 pass / 0 fail.

Real opencode2 (`@opencode-ai/cli` 0.0.0-next-17055, windows-x64 binary run
directly, isolated XDG/HOME sandbox): `bash .omo/evidence/20260811-opencode2-phase2/qa.sh`.
PASS=11 FAIL=0 (out/run-*.txt, out/trace.ndjson). Model: zhipuai/glm-4.7.

1. **Registration + tools** — default agent sisyphus; `omo.orchestration.registered`
   lists task / background_output / background_cancel.
2. **Sync task** — `task(subagent_type="explore", model="zhipuai/glm-4.7",
   prompt="reply with the single word done")`; the parent session reports the
   child's output `done`; trace `omo.task.finished ok=true background=false`.
3. **Background task** — `task(run_in_background=true)` returns a task id; the
   engine fires `omo.task.background-completed` (synthetic wake to the parent);
   the model then calls `background_output` and reports the child's `bgdone`.
4. **Continuation** — the model continues the same background task with
   `task(task_id=...)`; the trace shows a second `session.execution.started +
   succeeded` on the SAME child session id, and the parent reports both the
   first (`first`) and continued (`second`) outputs.
5. **Isolation** — no new files in the real opencode stores.

Also observed during interactive smoke: without a runnable model override, the
child session fails with `Model unavailable` (plan risk R14 — the v2 catalog
lists the full models.dev universe, only zhipuai is authenticated on this box);
the failure is correctly aggregated and returned to the parent (`Task failed:
...Model unavailable`), and the engine retries once on the next fallback-chain
model (two `session.execution.failed` events on distinct child sessions).

## Why this is enough for Phase 2

Phase 2 acceptance (plan §9) is "sync / background / continuation three paths
real, event evidence complete". All three ran against the real opencode2
binary with event-stream evidence: sync returns child output, background
returns a task id + completion notification + retrievable output, continuation
reuses the same child session and returns follow-up output. Unit tests cover
the pure engine pieces (registry, concurrency, fallback resolution).

## What was omitted

- Provider API key read from the real v1 auth store into the process
  environment only; never printed or persisted.
- Runtime provider-error fallback (429/503 retry chains beyond the single
  next-chain-model retry) and multi-provider concurrency tuning are not
  exercised here; the fallback-chain retry is observed once in the smoke run
  (two failed child sessions → failure surfaced), not asserted in qa.sh.
- `command` / `load_skills` paths of the task tool are implemented but not
  behaviorally exercised in this QA (no skills installed in the sandbox).
