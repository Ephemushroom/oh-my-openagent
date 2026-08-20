# @oh-my-opencode/omo-opencode2

OpenCode 2 (v2 plugin API, `@opencode-ai/plugin@next`) adapter for OMO. Ported from v1.

## Overview

The v2 adapter re-implements the highest-value v1 surface against the v2 plugin
API. Where v1 exports a declarative map of 14 named hook handlers, v2 registers
imperatively inside `setup` against typed draft-mutation APIs.

- Entry: `src/index.ts` (`export default Plugin.define({ id: "omo", setup })`),
  imported directly by opencode2 as TypeScript source.
- Trace: set `OMO_SPIKE_TRACE` to a file path to get NDJSON trace events for QA
  assertions. This is the primary observability surface; the CLI does not expose
  raw system parts or tool results.
- QA regimen: `.agents/skills/opencode2-qa/`. Port design: `.omo/plans/opencode2-port.md`.

## Registered surface

| Surface | Count | Detail |
|---|---|---|
| Agents | 11 | 4 primaries (sisyphus default, hephaestus, prometheus, atlas) + 7 subagents, plus delegation categories as subagents |
| Tools | 10 base + 3 gated | `task`, `background_output`, `background_cancel`, `hashline_edit`, `todowrite`, `look_at`, `session_list`, `session_read`, `session_search`, `session_info` + `create_goal`/`update_goal`/`get_goal` when `goal.enabled` |
| Hook families | 6 dirs + context composer | hashline read-enhancer, write-existing-file-guard, prometheus-md-only, comment-checker, rules-context, goal + the `session.hook("context")` composer |
| Skills | 17 | each `shared-skills` SKILL.md parsed and added via `skill.transform` |
| Commands | builtin | slash commands via `registerBuiltinCommands` |

## Implementation invariants

These are v2-API-specific and differ from v1. Read before editing.

- **The model catalog is empty at setup time.** It populates asynchronously via
  `catalog.updated`. `createCatalogSource()` captures each update and agent model
  resolution reads `catalog.current` later; a setup-time snapshot is empty and
  silently drops every agent onto its first fallback.
- **Agent transforms are lazy.** v2 defers `agent.transform` callbacks until first
  registry materialization; `await ctx.agent.reload()` forces them so the
  registration summary is not empty.
- **Prompts are baked once, patched per-request.** v2 has no config-phase prompt
  authority. The static sisyphus prompt is captured at registration via
  `onSisyphusPrompt`; the context hook locates and replaces that system part on
  every request.
- **Context injection is a single ordered composer.** v1 spreads context work
  across a 7-slot Transform tier; v2 exposes one `session.hook("context")` with
  `event.system`, `event.messages`, and `event.tools` together. Composition order
  in `hooks/register-context-hooks.ts` is load-bearing: sisyphus rebake, skill
  catalog, command catalog, rules, then keyword mode last.
- **Delegation dispatches via `session.synthetic`, not `session.prompt`.** The
  task engine uses `ctx.session.synthetic({ delivery: "queue" })` with a waiter
  map keyed by child session ID, settled by an event-subscription pump. This
  avoids v1's `promptAsync` duplicate-injection bug class.
- **v2 types are readonly over mutable runtime drafts.** Core reads arrays back
  after hooks, so in-place rewrite is the expected pattern.
- **`look_at` gates on the CALLER's vision capability; v1 always delegated.**
  v2's native `read` renders images and PDFs to the model, so delegating from a
  model that can already see the file wastes a child session. The gate needs the
  caller's model, which `ToolContext` does not carry, so `session.hook("context")`
  (the only surface exposing `model` beside `sessionID`) feeds a session-to-model
  registry that the tool reads at execute time. Routes are passthrough / delegate
  / unavailable; see `tools/look-at/vision-gate.ts`.
- **The catalog lists models the user cannot call.** `catalog.provider.list()`
  covers roughly 200 providers regardless of credentials, so
  `connectedProviders` means "known to the catalog", NOT "authenticated". Any
  code choosing a model to dispatch to must not assume a catalog entry is
  callable. `selectVisionModel` therefore prefers the caller's own provider,
  which is the one provider proven to authenticate, before any tuned chain.
  Verified: a chain-first choice picked an uncallable `openai/gpt-5.6-sol` on a
  zhipuai-only account and the delegated child failed with a routing error.
- **The shell/job registry is NOT reachable from a plugin.** `ctx.shell` is
  `ShellDomain`, which is `{ hook("create.before") }` and nothing else. The full
  `ShellApi` (`list`, `create`, `get`, `timeout`, `output` with a polling
  cursor, `remove`) does exist, but it hangs off `AppApi`, the HTTP client
  surface, and the plugin `Context` never hands that client out: `ctx.app` is
  `{ name, version, channel }` metadata, `ctx.plugin` is `PluginApi` which is
  `{ list }` over PLUGINS, and `ctx.options` is freeform config with no server
  handle. Contrast `SessionDomain`, which IS `Pick<SessionApi, ...> & { hook }`;
  shell was not given the same treatment. The capability ships only as server
  routes (`GET /api/shell` = `v2.shell.list`), which need pairing and answer 401
  otherwise. Verified on `0.0.0-next-17444`.

  **Scope this claim carefully.** It means a plugin cannot ENUMERATE OR CONTROL
  the shells the harness itself owns. It does NOT mean a plugin cannot run
  long-lived child processes: a plugin that spawns and owns its own children is
  unaffected, which is exactly what v1's monitor does (it never touched the
  OpenCode shell registry either). An earlier revision of this file wrongly
  extended the limit to "monitor-style tools cannot be built"; that was wrong.
- **`SessionDomain` cannot list sessions or read their messages.** It is
  `Pick<SessionApi, "create" | "get" | "prompt" | "generate" | "command" | "synthetic" | "interrupt">`.
  There is no `list` and no `messages`, so session-history tools cannot be built
  on `ctx.session`. opencode2 persists every session to SQLite at
  `$XDG_DATA_HOME/opencode/opencode.db` (`session_v2` plus `session_message`,
  the latter carrying an ordered `seq` and a JSON `data` payload), and
  `tools/session-manager/` reads that store directly, read-only, the same way v1
  reads OpenCode's storage. This couples to an internal schema on purpose: every
  reader degrades to a reported message instead of throwing when the shape
  changes. Verified on `0.0.0-next-17444`.
- **`aisdk` hooks only fire for providers that ship a provider plugin.** The
  `aisdk.hook("sdk" | "language")` domain exists in the plugin types, but core
  dispatches it from `createProviderPlugin`, which is instantiated only for the
  bundled `@ai-sdk/*` packages (alibaba, cohere, groq, mistral, perplexity,
  togetherai, deepinfra, gateway, ...). A provider resolved through any other
  path never reaches those hooks, so neither hook fires for it. Registration
  succeeds and the callback is simply never invoked, which looks identical to a
  silent bug. Model fallback built on this domain therefore cannot cover most
  providers; `session.hook("http.request")` and `session.hook("http.response")`
  do fire and are the viable interception point. Verified on `0.0.0-next-17444`
  by tracing both hooks in a live session.

## Goal idle continuation

Goal is default-off (`goal.enabled === true` required; `disabled_hooks`
respected). Its exclusion comes from the shared gate described under Session
dispatch, which it takes as a required `gate` dependency rather than owning.
`auto_start` (default off) creates a goal from the first main-session message.

## Todo idle continuation

A second idle injector. When the session goes idle with unfinished todos, it
injects a prompt listing them and nudging the model to continue. Default-off
(`todo_continuation.enabled === true`; `disabled_hooks` respected), and it
shares the one gate instance with goal so the two cannot both inject on one
edge. Bounded by `max_consecutive` (default 12): any drop in the remaining count
resets the budget, so a long productive run is never cut off and the bound only
bites when the model keeps going idle without finishing anything. Both
injectors are configurations of `orchestration/idle-injector.ts`: the feature
supplies the predicate, the prompt, and the trace name; the busy/idle tracking,
settle delay, post-settle re-checks and gated dispatch are shared.

## Boulder (start-work) idle continuation

A third idle injector. When the session goes idle owning an active plan in
`.omo/boulder.json` with unchecked top-level tasks, it injects the next task and
nudges the model to continue the plan. Default-off (`boulder.enabled === true`;
`disabled_hooks` respected), and it shares the one gate instance with goal and
the todo enforcer. Its state is entirely on disk and re-read on every idle, so
it holds no in-memory boulder state and survives a restart. v2 runs the
single-active-work mirror mode, not v1's N-work `works` map: a session owns
work when its id is recorded (`boundVia="session"`, a resumed session) or when
the file holds exactly one active work (`boundVia="sole-active"`). More than
one active work and no recorded id returns null, the safe direction; explicit
multi-work resume is v1-only. The checklist is parsed by the harness-neutral
`@oh-my-opencode/boulder-state` core; the adapter imports it and must not fork
it.

## Session history tools

`tools/session-manager/` serves `session_list`, `session_read`, `session_search`,
and `session_info` by reading opencode2's SQLite store. Registered
unconditionally; there is no config gate.

- `db-path.ts` resolves the store: `OMO_OPENCODE2_DB`, then
  `$XDG_DATA_HOME/opencode/opencode.db`, then `~/.local/share`, then
  `%LOCALAPPDATA%` on win32. A missing store is a normal result, not an error.
- `store.ts` opens `bun:sqlite` with `{ readonly: true }` and parameterizes every
  statement. It must never gain a write path.
- `message-shape.ts` parses `session_message.data` into a typed union and falls
  back to `unknown` rather than throwing, because the schema is internal to
  opencode2 and can change between builds.
- Defaults are project-scoped: `session_list` and `session_search` filter on the
  workspace directory and skip child sessions unless asked. Search skips
  assistant reasoning, so it matches what the model actually said.

## Session dispatch

`orchestration/session-dispatch-gate.ts` is the shared gate, v2's equivalent of
v1's `prompt-async-gate`. It reserves a session synchronously before any
`await`, compares a symbol token on release so a late release cannot free a
newer reservation, and holds the reservation for `postDispatchHoldMs` after a
dispatch so the next idle observer does not fire into a session the harness has
accepted a message for but not yet marked busy.

**One instance, created in `index.ts`, injected into every feature that injects
on an observed edge.** This is the load-bearing part. Extracting the code is not
what prevents double injection: two instances would each admit one dispatch, so
two features would still both inject on the same edge. `createGoalRuntime` and
`registerGoalFeature` therefore take `gate` as a REQUIRED dependency with no
default, so a new feature cannot silently get its own lock. A feature's
`dispose` must not clear the gate, since that would free another feature's
reservation. Two features genuinely share the gate today (goal and the todo
enforcer); the property that one edge admits exactly one injection across both
is unit-tested in `idle-injector.test.ts` and driven on the binary in
`.omo/evidence/20260817-opencode2-todo-continuation/`.

**The gate is for N observers of ONE edge, not N distinct events.** Do not put
per-item notifications behind it. Session writes happen in exactly three places,
and only one of them belongs to the gate:

| Site | Gated | Why |
|---|---|---|
| `hooks/goal/register.ts` | yes | Idle continuation. Shares the one gate. |
| `hooks/todo-continuation/register.ts` | yes | The second idle injector. Takes the SAME gate instance goal does. |
| `hooks/boulder-continuation/register.ts` | yes | The third idle injector (start-work). Same shared gate; re-reads the plan off disk on every idle. |
| `index.ts` background completion | NO | Fires once per TASK. Two tasks finishing together are two different notifications; a per-session reservation would silently drop the second and lose a completion. |
| `orchestration/child-session.ts` | NO | Prompts a child session the engine created and owns, with no competing observer. |

The pinned set is enforced by `src/orchestration/session-dispatch-audit.test.ts`,
which fails the suite when any new dispatch call site or reference appears.
Update the allowlist only with justification in the commit message.

## Conventions

- Never create a flat `foo.ts` next to an existing `foo/` directory module. Node
  resolves the file first and silently shadows the directory.
- Never `any`, `@ts-ignore`, or `@ts-expect-error`.
- Gates before commit: `bun test packages/omo-opencode2/src` (0 fail) and
  `bun run typecheck` (exit 0).
