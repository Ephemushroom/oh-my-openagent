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
| Tools | 5 base + 3 gated | `task`, `background_output`, `background_cancel`, `hashline_edit` + `create_goal`/`update_goal`/`get_goal` when `goal.enabled` |
| Hook families | 6 dirs + context composer | hashline read-enhancer, write-existing-file-guard, prometheus-md-only, comment-checker, rules-context, goal + the `session.hook("context")` composer |
| Skills | 17 | whole `shared-skills` tree registered as one directory source |
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

## Goal idle continuation

Goal is the only feature that injects on session idle, and it is default-off
(`goal.enabled === true` required; `disabled_hooks` respected). Its continuation
gate reserves the session synchronously before any `await`, so concurrent idle
events cannot both pass; release compares a symbol token; there is a
post-dispatch hold. `auto_start` (default off) creates a goal from the first
main-session message.

## Session dispatch

There is no shared dispatch gate in v2. Session writes happen in exactly three
places: `index.ts` (synthetic, background task completion notifies the parent),
`hooks/goal/register.ts` (synthetic, idle continuation behind its own
reservation gate), and `orchestration/child-session.ts` (prompt into a child
session the engine created and owns). v1 funnels all such calls through one
`prompt-async-gate`; v2 does not yet. The pinned set is enforced by
`src/orchestration/session-dispatch-audit.test.ts`, which fails the suite when
any new dispatch call site or reference appears. Do not add a second
idle-injecting feature without a shared gate; update the audit allowlist only
with justification in the commit message.

## Conventions

- Never create a flat `foo.ts` next to an existing `foo/` directory module. Node
  resolves the file first and silently shadows the directory.
- Never `any`, `@ts-ignore`, or `@ts-expect-error`.
- Gates before commit: `bun test packages/omo-opencode2/src` (0 fail) and
  `bun run typecheck` (exit 0).
