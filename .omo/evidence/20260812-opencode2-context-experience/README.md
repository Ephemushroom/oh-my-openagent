# Evidence: OpenCode 2 port — Phase 3 (context experience)

Date: 2026-08-12. Plan: `.omo/plans/opencode2-port.md` (Phase 3/5.E context-hook pieces).
Branch: `feat/opencode2-context-experience` (over `dev` @ ad2d1aaf9).

## What was tested

Two production context hooks on `packages/omo-opencode2`:

1. **Dynamic Sisyphus prompt rebake** — every model request fetches the live
   agent/skill catalogs (`ctx.agent.list()` / `ctx.skill.list()`) and rebuilds
   the static Sisyphus system part with the real `AvailableAgent[]` (from the
   six-specialist metadata table), tools (from the context event), skills, and
   categories (derived from the agent list). Only the system part whose text
   exactly equals the registration-time static prompt is replaced; project and
   third-party parts are preserved. Non-fatal on catalog fetch failure.
2. **Ultrawork keyword injection** — a user turn containing whole-word
   `ulw`/`ultrawork` appends one `<ultrawork-mode>` system part, routed by
   model family (planner → gpt → gemini → glm → default) via
   `@oh-my-opencode/prompts-core` variants. Tag-based idempotency: repeated
   context calls never duplicate the mode part.

Also fixed while testing: the `task` tool's `model` parameter was missing from
the merged Phase 2 branch (it existed only in the worktree); restored it so
callers can pin the child session to a runnable model (R14 mitigation). The
tool description now explicitly instructs the model to pass `model`.

## What was observed

Unit (`packages/omo-opencode2/src`): 32 new tests across
prompt-metadata / sisyphus-prompt / sisyphus-context / ultrawork-context /
register-context-hooks (52 total, 0 fail, typecheck clean). RED→GREEN captured
per wave (module-not-found REDs, then green).

Real opencode2 (`0.0.0-next-17055`, windows-x64 binary, isolated XDG/HOME):
`bash .omo/evidence/20260812-opencode2-context-experience/qa.sh`.
**PASS=9 FAIL=0** (out/run-*.txt, out/trace.ndjson). Model: zhipuai/glm-4.7.

1. **Live catalogs fetched per request** — trace `omo.context.agents count=25`,
   `omo.context.skills`, `omo.context.composed` on every model request.
2. **Dynamic prompt → delegation** — the default agent (sisyphus) now knows the
   `task` tool and the subagent catalog; asked to delegate to `explore`, it
   invoked `task(subagent_type="explore", model="zhipuai/glm-4.7")`, the child
   ran on the pinned runnable model, and sisyphus reported the child's
   `done`/structured output. Trace `omo.task.start agent=explore
   model=zhipuai/glm-4.7`.
3. **Ultrawork injection** — a prompt starting `ulw:` produced
   `omo.context.composed systemParts=3 modeTagged=true` (the tagged part was
   appended); a plain prompt stayed `modeTagged=false`. The model replied
   (banner compliance is probabilistic; the mechanism proof is the tag).
4. **Isolation** — no new files in the real opencode stores
   (out/isolation-violations.txt empty).

## Why this is enough

Both hooks are proven at the mechanism level by the trace (live catalogs
fetched, only the sisyphus part replaced, mode tag injected once) and at the
behavior level by the real opencode2 runs (sisyphus delegates via task on the
pinned model; ulw activates the mode tag). The composition ordering
(dynamic-first, ultrawork-second) is covered by the register-context-hooks
tests, including the failure-survival case (catalog down → static prompt kept,
mode still injected).

## What was omitted

- Provider API key read from the real v1 auth store into the process
  environment only; never printed or persisted.
- Model compliance with the injected ultrawork banner is not asserted as
  pass/fail (probabilistic); the mechanism (tag present once) is the gate.
- `default_mode.ultrawork` (always-on injection) and `team`/`hyperplan`
  keywords are not ported in this phase; only `ultrawork`/`ulw` per the
  user's reported gap.
