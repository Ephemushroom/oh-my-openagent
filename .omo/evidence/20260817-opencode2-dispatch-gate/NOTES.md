# QA: shared session dispatch gate (omo-opencode2)

Change: extract goal's private reservation logic into
`orchestration/session-dispatch-gate.ts` and inject ONE instance from
`index.ts`. Behavior-preserving for goal; the point is that a second
idle-injecting feature can now share the same lock.

## What was tested

`qa.sh` against the real pinned opencode2 binary in an isolated sandbox
(`mktemp -d` HOME + all four XDG dirs, `OPENCODE_DISABLE_AUTOUPDATE`,
`OPENCODE_DISABLE_MODELS_FETCH`). The plugin is wired through the sandbox
`opencode.jsonc`, `goal.enabled` is turned on in `.omo/omo.json` because goal is
the only gated dispatch site, and the session is driven to create a goal and
then reach an idle edge, which is what arms the continuation.

All assertions read the `OMO_SPIKE_TRACE` NDJSON. None read CLI prose.

## What was observed

PASS=5 FAIL=0.

| Check | Result | Meaning |
|---|---|---|
| `plugin-loaded` | 178 trace lines | the plugin actually ran |
| `registered` | `omo.goal.registered` x1 | goal registered with the gate threaded |
| `single-dispatch` | `continuation-injected=1`, `continuation-failed=0` | exactly one continuation on the idle edge |
| `no-pump-error` | `omo.goal.event-error` x0 | nothing escaped the goal event pump |
| `isolation` | host `opencode.db` absent before and after | no host-store write |

`continuation-injected=1` is the load-bearing number. It is not zero, so the
gate still admits the dispatch, and it is not two, so it does not double-fire.

`no-pump-error=0` is what proves the required `gate` dependency is really
threaded through `index.ts` to `configured-register` to `register` to the
runtime. An unthreaded gate is not a type-only problem: it throws
`TypeError: undefined is not an object (evaluating 'gate.run')` on the first
idle inside the pump. That exact error is what the unit suite produced mid-
refactor before the call sites were updated, so the failure mode is real and
this check discriminates against it.

## Why it is enough

The realistic regressions for this refactor are "goal stops injecting",
"goal injects twice", and "the gate is not actually wired". The live run covers
all three on the real binary. Unit coverage backs it: 9 new gate tests including
both directions of the shared-instance property (one shared instance admits
exactly one dispatch across two features; two separate instances admit two,
which is the bug being prevented), plus the pre-existing goal runtime test
"concurrent and repeated idle edges -> one continuation" still passes unchanged,
which is the behavior-preservation check.

Gates: `bun test packages/omo-opencode2/src` 200 pass / 0 fail (191 on base,
+9 new), `bun run typecheck` exit 0.

## Two harness bugs found and fixed before trusting the result

The first run reported PASS=3 FAIL=1 and was a FALSE result worth recording,
because it is the same trap caught during look_at QA.

1. `opencode2 run` has no `--cwd` flag. The binary printed its help and never
   ran, yet three "no bad thing happened" checks still passed, because zero
   events satisfies every negative assertion. An explicit `plugin-loaded` guard
   was added so an inert run can never be green, and the run now `cd`s into the
   project and uses `--standalone --auto --agent sisyphus --model ...`.
2. The plugin path was written into the config as an MSYS `/d/...` path, which
   the native Windows binary cannot resolve. The agent silently fell back to the
   `build` agent on a default model with no `create_goal` tool and started
   grepping the filesystem for one. Fixed with `cygpath -m` so the config
   carries a `D:/...` path.

Also fixed: `grep -c ... || echo 0` emitted two zeros on no-match, since
`grep -c` exits non-zero when the count is 0.

## What was omitted

No keys, auth headers, or env dumps are recorded. `ZHIPU_API_KEY` is read from
the host auth store at run time and passed to the child process only; it never
appears in `out/`. `out/trace-tail.ndjson` is capped at the last 50 lines
because the full trace carries the catalog snapshot for every known provider,
which is reviewer-noise and drags legacy model identifiers into committed
surfaces that repo audits scan.

Not covered: two real features contending on one live idle edge. Goal is
currently the only idle injector, so that path has unit coverage only. It should
be re-QA'd on the live binary when the todo continuation enforcer lands, which
is the first change that makes the contention real.
