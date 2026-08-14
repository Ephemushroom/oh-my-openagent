# OpenCode2 Docs + Probe Removal QA Evidence

Date: 2026-08-15 | Branch: `feat/oc2-docs` | Base: `dev` at `ef0748754`

## WHAT WAS TESTED

Two coordinated changes that bring the adapter's docs in line with what it ships
and remove the leftover spike verification surface:

1. Rewrote `packages/omo-opencode2/AGENTS.md`. It previously described the spike
   stage (2 agents, 2 tools, `omo-spike` default) and is now accurate for the
   shipped capability. Synced the matching one-liner in `packages/AGENTS.md`.
2. Removed the `OMO_SPIKE_MECHANICS` mechanics probe from
   `packages/omo-opencode2/src/index.ts`: its 9 constants, the gated
   `setupMechanicsProbe(ctx, trace, engine)` call, the probe function itself, the
   now-unused `Context` import, and the now-unused `readPrompt` helper. `index.ts`
   went from 393 to 199 lines.

Verification:

- Unit: `bun test packages/omo-opencode2/src` at 144 pass, 0 fail, 30 files.
- Type safety: `bun run typecheck` exit 0.
- Markdown: `bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts`
  16 pass, 0 fail.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe`
  `0.0.0-next-17055` with `zhipuai/glm-4.7` in an isolated XDG/HOME/USERPROFILE
  sandbox, asserting registration trace events after the probe removal.

## WHAT WAS OBSERVED

`out/qa-summary.txt`: `summary: PASS=9 FAIL=0`.

- Live session completed with the probe removed and `OMO_SPIKE_MECHANICS` unset.
- Registration events all present on the real binary: `omo.registration.complete`,
  `omo.orchestration.registered`, `omo.tool-guards.registered`,
  `omo.context-hooks.registered`, `omo.skills.registered`.
- The probe's own trace events (`agents.registered`, `tools.registered`) are
  absent, confirming the spike surface no longer fires even though the flag was
  never set.
- Isolation: `out/isolation-violations.txt` is empty.

## WHY IT IS ENOUGH

The change removes runtime code from the plugin entry, so typecheck alone is not
QA. The live run proves the plugin still loads and registers its full surface
with the probe deleted, which is the only behavior the deletion could regress.
The negative assertions confirm the probe is actually gone rather than merely
unreached on this run.

Probe-consumer audit before deletion: the only references to `OMO_SPIKE_MECHANICS`
and the `omo-spike`/`omo_spike` markers outside `index.ts` are the historical
spike evidence (`20260810-opencode2-spike/qa.sh`, `20260811-opencode2-phase1/README.md`).
No PR from #12 through #25 depends on the probe; each ships its own trace events
and assertions. So removal is safe and the historical evidence is intentionally
left as a record of the spike.

## WHAT WAS OMITTED

- `OMO_SPIKE_TRACE` is kept. It is the adapter's primary observability surface and
  every current PR's QA asserts against it. Only the `OMO_SPIKE_MECHANICS`-gated
  probe was removed; the trace mechanism itself stays.
- Historical spike evidence is not edited; it documents a stage that no longer
  exists in code but is still accurate as history.
- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. Never printed, copied, or committed.
- `models.json` is excluded from the isolation sweep for the documented reason
  (opencode2 owns that global provider catalog; the plugin never writes it).
- The known Windows `spawn-with-timeout.test.ts` failure is pre-existing on clean
  `dev` and was not run or changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
