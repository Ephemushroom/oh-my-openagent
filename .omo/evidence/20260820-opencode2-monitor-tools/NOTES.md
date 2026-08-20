# QA: opencode2 monitor tools

Change under QA: `packages/omo-opencode2/src/features/monitor/` +
`packages/omo-opencode2/src/tools/monitor/`, wired in `src/index.ts`.
Result: **12 / 12 PASS**. Harness: `qa.sh`. Raw output: `out/`.

## What was tested

The real pinned opencode2 binary (`0.0.0-next-17444`) was driven in a throwaway
sandbox with the v2 adapter loaded from TypeScript source. The session was asked
to start a monitor over a deterministic Node script, list it, read its unmatched
buffer, and stop it.

`watch.js` prints, in order: a non-matching line, `ERROR alpha`, another
non-matching line, `ERROR beta`, then exits. The monitor was started with
`match_pattern "ERROR"`, so only the two ERROR lines should ever be pushed at
the model on their own.

Assertions read the `OMO_SPIKE_TRACE` NDJSON and the sandbox SQLite store. They
do not read CLI prose: the v2 CLI does not surface tool results, so asserting on
`run.txt` would pass without proving anything.

## What was observed

| # | Check | Result |
|---|---|---|
| 1 | trace non-empty (anti-vacuity guard) | PASS |
| 2 | `omo.monitor.registered` fired, so the config gate opened | PASS (1) |
| 3 | registration event names the four tools | PASS |
| 4 | `omo.monitor.delivered` fired | PASS (1 batch) |
| 5 | the delivered batch carried lines, not an empty payload | PASS |
| 6 | an `[OMO MONITOR OUTPUT]` envelope reached the session store | PASS |
| 7 | the envelope contains `ERROR alpha` | PASS |
| 8 | the envelope does NOT contain the non-matching lines | PASS |
| 9 | the `untrusted_observation` banner survived into the real payload | PASS |
| 10 | no orphan process check | PASS |
| 11 | no `omo.monitor.delivery-failed` | PASS |
| 12 | host store untouched: `session_v2` count 1134 before and after | PASS |

Check 8 is scoped to rows containing the envelope marker on purpose. The prompt
also has the model call `monitor_output(stream="unmatched")`, and those lines
legitimately return as a tool result. A whole-database grep cannot tell "pushed
at the model automatically" from "explicitly requested", so it would report a
false failure. An earlier revision of this harness did exactly that.

## Defect found by this QA

The first run came back `tools-registered: FAIL` with
`omo.monitor.disabled reason="monitor.enabled is not true"` even though the QA
config set it.

Root cause is in the config layer, not the monitor code:
`@oh-my-opencode/omo-config-core` rejects unknown keys at the config ROOT, and a
rejected file is discarded whole. A root-level `"monitor": {...}` therefore
invalidated the entire `.omo/omo.json` and every key in it was silently lost, with
`sources: []`. Adapter keys must live under the `"[opencode2]"` block.

`config-probe.ts` in this directory reproduces it in isolation and shows the same
outcome for a root-level `boulder` key, so this affects every opencode2 config key,
not just monitor. Recorded in `packages/omo-opencode2/AGENTS.md`.

## Why this is enough

The chain the feature exists for is proven end to end on the real binary: the
gate opens, the tools register, a child process is spawned and its stdout is
read, the filter selects, the batcher flushes, and the envelope is delivered
into the session store through the queued synthetic path. Both directions are
covered: the matching line is present and the non-matching lines are absent.

Unit coverage adds 37 tests (`bun test packages/omo-opencode2/src`: 296 pass,
0 fail) over the pipeline stages, the fail-closed permission gate, the
per-session cap, session-scoped reaping, dispose, and delivery dedupe.

## Residual risk

- Process-group kill on Windows falls back to a single-pid kill, since Windows
  has no process groups in the POSIX sense. A monitored command that itself
  spawns grandchildren could leave those behind on Windows. Not exercised here;
  the QA command is a single Node process.
- `live_mode_enabled` is accepted by the schema but not yet differentiated in
  behavior, because queued delivery already defers to the harness.
- Long-running monitors and the `max_runtime_ms` watchdog are unit-tested only,
  not driven for the full 30 minutes.

## What was omitted

No credentials in any artifact. The provider key is read from the host
`auth.json` into the child environment and never written to `out/`. `run.txt` is
the CLI transcript, `trace.ndjson` the plugin trace, and `sandbox-opencode.db`
the throwaway sandbox store; the host store was only counted, never copied.
