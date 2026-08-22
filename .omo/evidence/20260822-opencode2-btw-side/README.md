# opencode2 BTW side conversations

**Date:** 2026-08-22
**Binary driven:** `opencode2 v0.0.0-beta-17898` (isolated sandbox)
**Feature:** BTW side conversations ported from v1's `features/btw-side/` to the v2 adapter as `features/btw/`, reshaped for v2's API surface: tool-driven (`btw_start` / `btw_reply` / `btw_list`) instead of v1's TUI ctrl+b flow, because the v2 plugin API exposes no TUI registration surface.

## Design deltas vs v1 (and why)

| v1 | v2 | Reason |
|---|---|---|
| TUI keymap + picker + side-session navigation | `btw_start` / `btw_reply` / `btw_list` tools | v2 plugin API has no TUI surface; the same capability (side question without polluting the main conversation) is expressed as tools the model calls |
| side session tagged via opencode `session.metadata` | tag rides `session.prompt({ metadata })`, which v2 persists onto the user message | v2 `Session.Info` has no metadata field; prompt metadata is the supported channel (verified: core's projector writes `input.payload.metadata` into the user message) |
| parent context loaded via SDK `client.session.messages` | read from opencode2's SQLite store (same readonly `SessionStore` the session-manager tools use) | plugin `SessionDomain` has no message reader (documented AGENTS.md invariant) |
| boundary sentinel prepended to the first side user message; parent messages spliced in as real messages | boundary + bounded parent transcript rendered inline into the side prompt text | v2's context hook does not let a plugin restructure another session's message array; inline rendering achieves the same semantics (read-only background + answer-only-the-side-question) |
| tool-execute-before throws on delegation tools in side sessions | context hook `delete event.tools[name]` for the same set (+ task, btw_*, monitor_start) | v2's idiomatic tool-stripping surface; README documents exactly this pattern |
| budget: 64KB / 64 messages, binary-search tail truncation | ported unchanged (`boundParentTranscript`) | contract is harness-neutral |

## WHAT WAS TESTED

1. **Unit gates:** `bun test packages/omo-opencode2/src` → 331 pass / 0 fail (18 new tests: metadata create/parse/reject, budget pass-through/message-cap/byte-cap/single-oversized-truncation, render envelope, tools start/reply/list flows incl. unknown-side rejection and parent scoping, guard strip/no-touch/malformed-tag). `bun run typecheck` exit 0.
2. **Dispatch audit:** the two new `ctx.session.prompt` sites in `features/btw/tools.ts` are pinned in `session-dispatch-audit.test.ts` with justification — side sessions are plugin-created children with no competing observer, same class as `child-session.ts`, NOT idle-edge injections, so they take no gate.
3. **Live QA** (`qa.sh`, both directions): positive case drives a real session that reads a file then calls `btw_start`; negative case proves default-off.

## WHAT WAS OBSERVED

Final tally **PASS=10 FAIL=0**:

- `omo.btw.registered` / `started` / `finished` trace events fired in order
- the side session exists in the sandbox SQLite store with a `BTW · …` title
- the side session's user message carries the `omo_btw` metadata (store query hit)
- the boundary + parent-context text (`omo-btw-side` / `omo-btw-parent-context`) is present in the stored message
- the main-session model relayed the side answer (`BTWANSWER:` in the transcript)
- negative case: `omo.btw.disabled` traced, no registration
- isolation sweep: host store 1135 → 1135

## WHY IT IS ENOUGH

The load-bearing risks were: (a) prompt metadata not reaching the message (detection channel for the guard) — proven by the store query; (b) the waiter pump not resolving for a session created outside the task engine — proven by `omo.btw.finished` + the relayed answer; (c) parent context not loading from SQLite — proven by the boundary-injected store hit. The tool-guard strip itself is unit-proven (live proof would require the side session to attempt delegation, which the guard prevents by construction).

## LIVE VERSUS UNIT PROOF

Live: registration, side-session creation, metadata persistence, parent-context injection, answer relay, default-off, isolation. Unit-only: guard stripping (live branch prevented by the guard working), budget edge cases, malformed metadata rejection.

## WHAT WAS OMITTED

- `btw_reply` / `btw_list` not driven live (multi-turn live flow costs a second full session; both are unit-covered and ride the identical prompt/wait path `btw_start` proved)
- API keys stayed in child env only; no secrets in the bundle

## Artifacts

- `qa.sh`, `out/case1-run.txt`, `out/case1-trace.ndjson`, `out/case2-run.txt`, `out/case2-trace.ndjson`
