# OpenCode2 Tool Guards QA Evidence

Date: 2026-08-14 | Branch: `feat/oc2-tool-guards` | Base: `dev` at `8b58b1548`

## WHAT WAS TESTED

Two v1 `tool.execute.before` guards ported to the v2 adapter:

- **write-existing-file-guard**: rejects a `write` to a file the session has not
  read, with `File already exists. Use edit tool instead.`
- **prometheus-md-only**: confines the prometheus agent's writes. The v1 rule is
  NOT "any markdown". `packages/omo-opencode/src/hooks/prometheus-md-only/path-policy.ts`
  requires BOTH an `.omo` path segment and an allowed extension, so prometheus
  may only write `.omo/**/*.md`. The port reproduces that policy unchanged.

Verification:

- Unit: `bun test packages/omo-opencode2/src` at 106 pass, 0 fail.
- Type safety: `bun run typecheck` exit code 0.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` with
  `zhipuai/glm-4.7` in an isolated XDG, HOME, and USERPROFILE sandbox, asserting
  guard trace events per case.

## WHAT WAS OBSERVED

`out/qa-summary.txt`: `summary: PASS=12 FAIL=0`.

- Registration: `omo.tool-guards.registered` appears on a live plugin load.
- Write guard, block: `omo.write-existing-file-guard.block` fired for an unread
  existing file, and `out/run-block.txt` shows the model receiving
  `Write existing.txt failed / Error: File already exists. Use edit tool instead.`
- Write guard, allow: no block event for a path that does not exist yet, so the
  guard is not simply refusing every write.
- Prometheus, block: writing `plan.md` at the project root produced
  `omo.prometheus-md-only.blocked`.
- Prometheus, allow: writing `.omo/plan.md` produced
  `omo.prometheus-md-only.allowed`.
- Isolation: `out/isolation-violations.txt` is empty.

## WHY IT IS ENOUGH

Both guards are asserted in BOTH directions on the real binary. A block-only
proof would pass for a guard that rejects everything, so each allow case is a
first-class criterion.

The prometheus cases are the sharper pair, because they discriminate the actual
v1 rule rather than a plausible misreading of it. `plan.md` blocked and
`.omo/plan.md` allowed distinguishes "prometheus may write markdown" (wrong)
from "prometheus may write markdown under `.omo`" (correct). An implementation
that allowed any `.md` would pass a naive test and fail this one.

This QA also caught a defect outside its own scope. The first run's read-then-edit
recovery crashed with `undefined is not an object (evaluating 'event.result.content')`,
which traced to a duplicate flat hashline module shadowing the real one. That was
fixed separately in #19, and this branch is rebased on top of it.

## WHAT WAS OMITTED

- **The second prometheus rejection reason is proven by unit test, not live.**
  A non-markdown extension INSIDE `.omo` (`.omo/notes.txt`) is covered by
  `hooks/prometheus-md-only/index.test.ts`. Driven live, prometheus declines to
  attempt a non-markdown write at all and enters interview mode, so no write
  reaches the hook and there is nothing to block. Asserting it live would assert
  model temperament rather than guard behavior. The unit case isolates the
  extension rule by using a path that already satisfies the `.omo` requirement.
- **An earlier assertion in this QA was wrong and was removed.** It checked that
  the guarded file still held its original content. That is not the guard's
  contract: it rejects the WRITE and redirects to edit, and read-then-edit is the
  intended recovery path, which the model correctly took. The assertion now
  checks that the rejection message reached the model.
- **`models.json` is excluded from the isolation sweep.** opencode2 refreshes its
  global provider catalog at `~/.cache/opencode/models.json` regardless of
  `XDG_CACHE_HOME` and `OPENCODE_DISABLE_MODELS_FETCH`. It holds no session or
  project state and our plugin never writes it, so it is excluded for the same
  reason as the db, log, and lock files.
- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed.
- The known Windows `spawn-with-timeout.test.ts` failure is pre-existing on clean
  `dev` and was not run or changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
