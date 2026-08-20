# opencode2 session history tools, QA evidence

Change: adds `session_list`, `session_read`, `session_search`, `session_info` to
`packages/omo-opencode2`, reading opencode2's own SQLite store.

Harness: `qa.sh` in this directory. Real `opencode2` binary
(`0.0.0-next-17444`), isolated sandbox, live `zhipuai/glm-4.7`.

## What was tested

The four tools cannot use `ctx.session`: `SessionDomain` is
`Pick<SessionApi, "create" | "get" | "prompt" | "generate" | "command" | "synthetic" | "interrupt">`,
with no `list` and no `messages`. They read
`$XDG_DATA_HOME/opencode/opencode.db` instead. The QA therefore has to prove
three separate things: the tools register, they actually execute, and they
return real rows from the sandbox's own store rather than an empty or foreign
one.

The harness seeds distinguishable history (two sessions carrying
`ORANGE_MARKER_ALPHA` and `PURPLE_MARKER_BETA`), then drives three further
sessions that ask the model to call the tools by name.

## Assertion surface, and a correction to an earlier draft

The first version of this harness asserted on `run.txt`, the CLI output. That
was **vacuous**: the v2 CLI does not surface tool results, so the marker text
matched only because the model had echoed it in an earlier turn. Both checks
passed for the wrong reason.

The tools now emit `omo.session-tools.executed` trace events carrying the row
counts each call actually read, and the harness asserts on those. This is the
same NDJSON-over-prose rule the rest of the opencode2 QA follows.

## What was observed

`summary: PASS=15 FAIL=0`

| Check | Observed |
|---|---|
| plugin-loaded | trace non-empty (874 lines) |
| tools-registered | `omo.session-tools.registered` x5 |
| all-four-named | `session_list` / `session_read` / `session_search` / `session_info` all in the registration trace |
| sandbox-store-exists | store created under the sandbox `XDG_DATA_HOME` |
| sessions-seeded | `session_v2` rows=5 |
| marker-in-store | `ORANGE_MARKER_ALPHA` present in 4 message rows |
| session_list-executed | executed trace count=3 |
| session_list-returned-rows | at least one run reported `sessions>0` |
| session_search-executed | executed trace count=1 |
| session_search-ran-seeded-query | the seeded marker was the query |
| session_search-found-matches | at least one run reported `matches>0` |
| session_info-executed | executed trace count=1 |
| session_read-executed | executed trace count=1 |
| session_read-returned-messages | at least one run reported `totalMessages>0` |
| host-store-untouched | host `opencode.db` absent to absent |

Artifacts: `out/executions.ndjson` (per-call row counts),
`out/registration.ndjson`, `out/trace-tail.ndjson`, `out/run.txt`,
`out/sandbox-opencode.db` (the store the tools read).

## A real defect this QA caught

With the non-vacuous assertions in place, the first run failed
`session_search-found-matches`: every project-scoped call returned zero even
though the marker was provably in the store.

Root cause: `session_v2.directory` holds forward-slash paths
(`C:/Users/.../project`) while `process.cwd()` on Windows yields backslashes, so
`WHERE directory = ?` matched nothing and every project-scoped query came back
empty. The tools looked healthy because an unscoped call still worked.

Trace before the fix:

```
{"tool":"session_list","sessions":0,"scoped":true}
{"tool":"session_search","query":"ORANGE_MARKER_ALPHA","matches":0}
{"tool":"session_list","sessions":5,"scoped":false}
```

Fix: `normalizeDirectory()` folds separators and case, and the SQL compares
`lower(replace(directory, '\', '/')) = ?`. Two regression tests pin it
(a Windows-style path with different casing, and a trailing slash).

Trace after the fix:

```
{"tool":"session_list","sessions":3,"scoped":true}
{"tool":"session_search","query":"ORANGE_MARKER_ALPHA","matches":3}
```

## Why it is enough

The three failure modes that matter are covered by observation, not assertion:
the tools could fail to register (registration trace), fail to run (execution
trace), or run against the wrong or empty store (nonzero row counts plus the
host-store isolation check). The defect above shows the assertions have teeth:
they failed when the read path was broken and passed once it worked.

Unit gates: `bun test packages/omo-opencode2/src` 259 pass / 0 fail (37 new),
`bun run typecheck` exit 0.

## Residual risk

The store schema is internal to opencode2 and can change between builds. Every
reader degrades to a reported message instead of throwing, and
`message-shape.ts` falls back to an `unknown` variant, so a schema change
surfaces as a readable tool message rather than a crash. The schema is pinned
in `store.test.ts` by a fixture built from the real DDL, so an upstream change
shows up as a failing test rather than silent wrong output.

## What was omitted

No credentials in any artifact. The API key is read from the host auth store
into the child environment and never written to disk. `sandbox-opencode.db`
contains only the throwaway sessions this harness created.
