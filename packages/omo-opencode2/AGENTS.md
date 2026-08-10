# @oh-my-opencode/omo-opencode2

OpenCode 2 (v2 plugin API, `@opencode-ai/plugin@next`) adapter for OMO. Spike stage.

- Entry: `src/index.ts` (`export default Plugin.define({ id: "omo", setup })`), imported directly by opencode2 as TS source.
- The spike registers two agents (`omo-spike` primary + default, `omo-spike-sub` subagent), two tools (`omo_spike_echo`, `omo_spike_delegate`), an `execute.before`/`execute.after` mutation pair, a `session.hook("context")` mutation probe (system push, message redaction, tool removal), and a child-session orchestration proof driven by `ctx.event.subscribe()` + `ctx.session.synthetic`.
- Trace: set `OMO_SPIKE_TRACE` to a file path to get NDJSON trace events for QA assertions.
- Design doc: `.omo/plans/opencode2-port.md`. QA evidence: `.omo/evidence/20260810-opencode2-spike/`.
