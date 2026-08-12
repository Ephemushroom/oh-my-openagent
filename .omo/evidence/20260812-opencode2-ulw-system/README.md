# QA Evidence: omo-opencode2 ultrawork as system part

Date: 2026-08-12 | Branch: `feat/opencode2-ulw-system-part` | Base: `dev` @ 802ce5246

## Scope

User direction (2026-08-12): keep the ultrawork directive as a **system part**
(background context), reverting the inline user-turn placement from PR #8.
This is the fork's chosen placement — the directive is ambient system context
rather than a mutation of the user's own message.

## What was tested

### Unit gate (hermetic, `bun test`)

`packages/omo-opencode2`: **53 pass / 0 fail**, `tsgo --noEmit` clean.

- `ultrawork-context.test.ts` — `injectUltraworkSystemPart` (4 tests): append
  one tagged system part; skip when tag present; repeated calls keep one tag;
  empty system array gets the tag as its only part.
- `register-context-hooks.test.ts` — composition (4 tests): rebake-then-inject
  ordering; tag in system not messages; non-matching turn untouched; repeated
  calls keep exactly one tag in system.

RED→GREEN captured: module-not-found RED for `injectUltraworkSystemPart`,
then green after the swap back.

### Real-surface QA (isolated sandbox, real opencode2 binary)

`bash .omo/evidence/20260812-opencode2-ulw-system/qa.sh` — **PASS=5 FAIL=0**
(`out/`: `run-ulw.txt`, `export-ulw.json`, `inline-check.txt`, `trace.ndjson`,
`isolation-violations.txt`). Model `zhipuai/glm-4.7`, binary
`opencode2 v0.0.0-next-17055` (windows-x64), isolated XDG/HOME.

1. **`ulw.mode.tagged`** — trace `omo.context.composed modeTagged=true`,
   sourced from the system parts.
2. **`ulw.model.saw`** — exported session shows the assistant's reasoning
   echoing the ultrawork-mode directive (the dispatch-time system draft
   reached the model).
3. **`ulw.banner.leads`** — when the model complies, the banner leads the
   visible reply with no preamble before it.
4. **`ulw.banner.first`** — banner observed at line 3 of the run transcript.
5. **`isolation.clean`** — no v2 writes into the real opencode stores.

## Why this is enough

The system-part placement is pinned by unit tests (append + tag-guard
idempotency) and by real-binary QA (the model's reasoning echoes the directive;
the banner leads the reply when said). The composed trace keeps the sessionID
threading from PR #8 so QA can export the exact session.

## What was omitted

- No secrets/env dumps. Provider key read into child env only, never persisted.
- Banner compliance remains model-probabilistic (as in v1); the mechanism proof
  is the tag + reasoning echo, not the banner string itself.
- The v1 client-side toast has no v2 plugin API surface (confirmed in PR #8);
  not attempted here.
- `default_mode.ultrawork` (always-on) and `team`/`hyperplan` keywords remain
  out of scope.
