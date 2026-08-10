# Evidence: opencode2 spike (omo-opencode2)

Date: 2026-08-10. Plan: `.omo/plans/opencode2-port.md` (Phase 0).
Subject: `packages/omo-opencode2` spike plugin driven against the real opencode2 beta
(`@opencode-ai/cli@next` = 0.0.0-next-17055, windows-x64 binary run directly; the npm
launcher shim `@opencode-ai/cli/bin/opencode2.exe` is broken on this host — finding F1).

## How to reproduce

`bash .omo/evidence/20260810-opencode2-spike/qa.sh` (Git Bash on Windows; bash on Linux/macOS).
Env overrides: `OPENCODE2_BIN`, `OMO_SPIKE_MODEL` (default `zhipuai/glm-4.7`).
The driver builds an isolated sandbox (XDG_* + HOME/USERPROFILE/OPENCODE_TEST_HOME all
redirected), writes a fixture project with the spike plugin as a `plugins` config entry and a
hand-rolled stdio MCP fixture (`mini-mcp.mjs`) registered with `codemode: false`, then runs
`opencode2 run --standalone --auto` cases and asserts on transcripts, the exported session
JSON, and the plugin's own NDJSON trace (`OMO_SPIKE_TRACE`).

## What was tested and observed (final run: PASS=15 FAIL=0, see out/qa-console.log)

1. **Agent registration + default** — `ctx.agent.transform` upserts `omo-spike` (primary) and
   `omo-spike-sub` (subagent); `draft.default("omo-spike")` makes the run header show
   `> omo-spike · glm-4.7` without any `--agent` flag, and its system prompt is honored
   (every reply starts with `OMO-SPIKE-7f3a9`). Evidence: out/run-*.txt.
2. **Custom tool + execute.before/after mutation** — `tool.transform(draft.add)` registers
   `omo_spike_echo`; the before hook rewrites input to `BEFORE(hello)` (trace
   `tool.echo.executed`), the after hook appends `:AFTER` to the result (trace
   `tool.after.mutated`, note result.content arrives as a Content[] array, not a string).
   The model quotes the doubly-mutated result verbatim: `echo:BEFORE(hello):AFTER`
   (out/run-echo.txt) and the mutated result is persisted in the exported session
   (out/export-echo.json).
3. **Context hook (`session.hook("context")`)** — fires on every model dispatch with mutable
   `system`/`messages`/`tools` (trace `context` entries list the full tool surface per call):
   - system push: the pushed `You MUST end every reply with ...OMO-SPIKE-CTX-22cc` is followed
     by the model in at least one run (out/run-delegate.txt, out/run-noecho.txt). Model
     compliance with the marker is per-run probabilistic; the mechanism proof is the trace.
   - messages mutation: `token=TOPSECRET-9911` is rewritten to `token=[REDACTED]` before
     dispatch; the assistant reacts to redacted content (out/run-redact.txt, trace redactions).
   - tools removal: with the `[no-echo]` flag the hook deletes `omo_spike_echo` from the
     dispatch tools; the run then never executes it (trace `removed`, out/run-noecho.txt).
4. **Child-session orchestration via public ctx only** — `omo_spike_delegate` does
   `session.create({agent})` -> `session.prompt()` (auto-resumes, no explicit resume needed)
   -> completion detected on `ctx.event.subscribe()` (`session.execution.succeeded`, durable
   ordered: `session.text.ended` precedes it) -> aggregated child text returned as the tool
   result. The parent run quotes the child answer `4` (out/run-delegate.txt, trace
   delegate.* entries with captured lengths 178/2017 chars).
5. **Synthetic parent wake** — after the child completes, the plugin calls
   `ctx.session.synthetic({sessionID: parent, delivery: "queue"})`; the exported parent
   session contains the synthetic message AND the parent's follow-up turns reacting to it
   (out/export-parent.json + transcript shows the parent acknowledging the notification).
   This is the v2 primitive that replaces omo's v1 prompt-async-gate for internal injection.
6. **MCP via config** — the fixture's `mcp.servers.mini` (local stdio, `codemode: false`)
   connects and its `mini_echo` tool appears in the dispatch tool record seen by the context
   hook on every run (trace `context` entries), proving config-driven MCP interop.
7. **Isolation** — v2 wrote its store only inside the sandbox
   (`data/opencode/opencode.db*`), and no v2-attributable files appeared in the real
   `~/.local/share/opencode` or `~/.config/opencode` (find -newer check with live-v1-session
   paths excluded; out/isolation-violations.txt is empty).

## Spike findings (feed into the port design)

- F1: The npm-installed `opencode2` launcher exe is not runnable on this Windows host
  ("not compatible with the version of Windows"); run the platform binary directly:
  `node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe`.
- F2: Commands that require the persistent background service (`plugin list`,
  `debug agents`, `mcp list`, and `api` without `--standalone`) time out on this host.
  `run --standalone` works and is the QA surface. `api --standalone get /api/plugin|agent`
  returns empty `data` (standalone does not materialize location state) — do not use it as
  a registration proof; prove registration behaviorally via `run`.
- F3: Subagent replies may contain reasoning only — no `session.text.ended` at all
  (observed on child 1 with glm-4.7). Event-stream collectors must also accumulate
  `session.reasoning.ended` text as fallback. (omo's v1 empty-task-response-detector exists
  for exactly this class of behavior.)
- F4: `execute.after` receives `result.content` as a `Content[]` array even when the tool
  returned a string; mutate array parts, not just the string form.
- F5: The event stream is durable and ordered; `session.text.ended` precedes
  `session.execution.succeeded`, so terminal-event-then-drain is a safe read pattern.
- F6: The v2 docs' `tools.add("name", def)` signature is stale; the published API is
  `draft.add({ name, ... })` (single object). Type against `@opencode-ai/plugin`'s published
  `.d.ts`, not the docs.
- F7: v2 reads `xdg-basedir` env vars on Windows too, so XDG_* redirection fully sandboxes
  it; the npm beta otherwise shares the `opencode` data dir name with v1.

## Why this is enough

Each of the six Phase-0 spike items has at least one mechanism-level proof (plugin trace or
exported session state) and, where the surface is model-facing, a behavioral confirmation in
the transcript. Residual risk is concentrated in areas deliberately not spiked: per-agent
model resolution against the v2 catalog, the absence of a public `session.messages` read API
(R1 in the plan), and compaction hooks (R5).

## What was omitted

- The provider API key was read from the real v1 auth store into the child process
  environment only; it is never printed or persisted. Evidence files were scanned for all
  known secrets from that store before commit (no hits).
- Raw server logs contain provider request metadata and are kept only in the throwaway
  sandbox, not copied into evidence.
