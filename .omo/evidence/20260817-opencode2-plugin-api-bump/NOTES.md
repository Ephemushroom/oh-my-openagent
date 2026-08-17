# opencode2 plugin API bump: 0.0.0-next-17055 -> 0.0.0-next-17444

Date: 2026-08-17
Scope: `packages/omo-opencode2` (`@opencode-ai/plugin` + `@opencode-ai/schema` pin,
shared-skill registration, adapter docs, `opencode2-qa` skill version reference).

## WHAT WAS TESTED

Driven surface: the real pinned `opencode2` binary
(`@opencode-ai/cli-windows-x64@0.0.0-next-17444`), run from an isolated sandbox
with the adapter loaded from TypeScript source, via `.omo/evidence/20260817-opencode2-plugin-api-bump/qa.sh`.

| Check | Command / action | Behavior it proves |
|---|---|---|
| `skills-registered` | `opencode2 run --standalone --auto` with `OMO_SPIKE_TRACE` | the rewritten registration runs and adds every bundled skill under the new `SkillDraft` API |
| `answered` | same session, prompt `What is 2+2?` | a real session still completes end to end on the bumped binary |
| `skills-visible` | second session instructed to invoke the `skill` tool with id `git-master`, then inspect opencode2's own session store | core resolved the id we registered and read the file at the `location` we supplied |
| `isolation` | sha1 sweep of the host `~/.local/share/opencode` and `~/.codex` before and after | the run wrote nothing into host stores |

Unit gates: `bun test packages/omo-opencode2/src` and `bun run typecheck`.

## WHAT WAS OBSERVED

`summary: PASS=4 FAIL=0`.

- `skills-registered`: trace event `omo.skills.registered` with `count: 17`
  (`out/skills-event.json`, full stream in `out/trace-bump.ndjson`).
- `answered`: session replied `4` (`out/run-bump.txt`).
- `skills-visible`: the CLI rendered `Skill "git-master"` with no load error, and
  `Mode Gate` reached opencode2's session database. That heading exists only in
  `packages/shared-skills/skills/git-master/SKILL.md`, so its presence in the
  transcript proves the skill body was loaded through opencode2's own skill tool
  rather than merely passed to our callback (`out/run-skill.txt`,
  `out/trace-skill.ndjson`).
- `isolation`: host snapshot hash identical before and after.
- Unit gates: 164 pass / 0 fail across 34 files; `typecheck` exit 0.

Before the bump the same tree failed `typecheck` with one error, because
`SkillDraft.source()` was replaced by `list()/add()/update()/remove()` over
`Skill.Info`. Registration was rewritten to parse each bundled `SKILL.md` and add
it explicitly, mirroring the idiom core uses for its own built-in skills.

## WHY IT IS ENOUGH

The bump's only source-level break was shared-skill registration, and that path is
now proven at the level that matters: not "our callback ran", but "opencode2
loaded one of our skills and put its body in the transcript". Session completion
plus a clean isolation sweep cover the rest of the adapter's startup path on the
new binary, and the unit suite plus `typecheck` pin conformance to the 17444
types.

Residual risk: only `git-master` was loaded end to end, so a malformed
frontmatter in some other bundled skill would surface as a wrong `name` or a
missing `description` rather than a hard failure. The registration reads all 17
and the count assertion catches a wholesale regression, but not a per-skill
metadata defect.

## WHAT WAS OMITTED

- No model-fallback feature ships in this change. It was implemented against
  `aisdk.hook("language")` and then removed after QA proved that domain never
  dispatches for the providers we use: core only instantiates it from
  `createProviderPlugin`, which exists solely for the bundled `@ai-sdk/*`
  packages. Both hooks were traced in a live session and neither fired, on
  `next-17055` and on `next-17444`. The finding is recorded in
  `packages/omo-opencode2/AGENTS.md`; `session.hook("http.request")` and
  `session.hook("http.response")` were verified to fire and are the viable
  interception point for a future attempt.
- The HTTP `/skill` endpoint returns 401 without server pairing, so the
  first-party check reads the session store instead of the API. No pairing token
  was captured.
- Provider credentials are read from the host auth file and exported only into
  the child process environment. No key material is written to any artifact in
  `out/`.
