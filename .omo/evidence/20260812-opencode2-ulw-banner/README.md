# QA Evidence: omo-opencode2 ultrawork banner parity (inline injection)

Date: 2026-08-12 | Branch: `feat/opencode2-ulw-banner` | Base: `dev` @ 5fe01007f

## Scope

Move v2's ultrawork injection from a detached **system part** (appended via the
`session.hook("context")` composer) to **inline placement at the end of the
user's own message** — v1's placement (`hook.ts:231-240` in omo-opencode),
which is what made the model say "ULTRAWORK MODE ENABLED!" before its thinking
block.

v2 capability confirmation (from the installed `@opencode-ai/plugin@0.0.0-next-17055`
type surface + the Phase-0 spike probes):
- **Inline message mutation: PROVEN.** The context hook fires with mutable
  `system`/`messages`/`tools`; the spike's redaction probe rewrote user text in
  place and the assistant reacted to the mutated content.
- **Client-side toast: NOT AVAILABLE.** `Context` has no `client.tui` domain;
  `EventDomain` is `subscribe`-only (no publish); the client exposes no
  `tui.*` method group. The `tui.toast.show` event type exists in the event
  stream but plugins have no emitter. v1's "Ultrawork Mode Activated" toast has
  no v2 surface to port. The inline injection is the parity fix that matters —
  it restores the banner-first ordering.

## What was tested

### Unit gate (hermetic, `bun test`)

`packages/omo-opencode2`: **55 pass / 0 fail**, `tsgo --noEmit` clean.

- `ultrawork-context.test.ts` — new `injectUltraworkIntoUserTurn` (6 tests):
  inline append to the last user turn's final text part; skip when tag already
  present; same-turn follow-up dispatch (tool result) does not re-append;
  no-text-part user turn is a no-op; assistant/tool messages untouched;
  multi-part message lands on the last text part.
- `register-context-hooks.test.ts` — composition (4 tests): rebake-then-inline
  ordering; tag in messages not system; non-matching turn untouched; repeated
  calls keep exactly one tag in the user message.

RED→GREEN captured: module-not-found RED for `injectUltraworkIntoUserTurn`,
then green after implementation.

### Real-surface QA (isolated sandbox, real opencode2 binary)

`bash .omo/evidence/20260812-opencode2-ulw-banner/qa.sh` — **PASS=5 FAIL=0**
(`out/` artifacts: `run-ulw.txt`, `export-ulw.json`, `inline-check.txt`,
`trace.ndjson`, `isolation-violations.txt`). Model: `zhipuai/glm-4.7`,
binary `opencode2 v0.0.0-next-17055` (windows-x64), isolated XDG/HOME.

1. **`ulw.mode.tagged`** — trace `omo.context.composed modeTagged=true`, now
   sourced from the messages array.
2. **`ulw.model.saw`** — the exported session shows the assistant's reasoning
   explicitly echoing the ultrawork-mode directive ("...with a long
   ultrawork-mode section that appears to be instructions...") — the directive
   reached the model on the dispatch-time draft.
3. **`ulw.banner.leads`** — when the model complies, the banner leads the
   visible reply with no preamble before it
   (`"ULTRAWORK MODE ENABLED!\n\nok"`).
4. **`ulw.banner.first`** — banner observed at line 3 of the run transcript.
5. **`isolation.clean`** — no v2 writes into the real opencode stores.

## Why this is enough

- Placement is pinned by unit tests (message mutation, tag guard, same-turn
  idempotency) and by the real-binary QA (model reasoning echoes the directive;
  the banner leads the reply when said).
- The export persists the original user text by design (the injection lives on
  the dispatch draft, not the store) — so the durable behavioral proof is the
  assistant's reasoning echo + banner position, both captured.
- The v1 difference the user reported (banner after Thinking instead of before)
  is explained by placement: system-part = background context (think first);
  inline user-turn = immediate instruction (banner first). This change restores
  the inline placement.
- The v1 client-side toast cannot be ported: this plugin API version exposes no
  toast/event-emit surface for plugins (confirmed against the published `.d.ts`).

## What was omitted

- No secrets/env dumps. The provider key is read from the v1 auth store into
  the child process env only; never printed or persisted.
- Banner compliance remains model-probabilistic (as in v1); the mechanism proof
  is the tag + reasoning echo, not the banner string itself.
- `default_mode.ultrawork` (always-on) and `team`/`hyperplan` keywords remain
  out of scope (only `ultrawork`/`ulw` per the reported gap).
