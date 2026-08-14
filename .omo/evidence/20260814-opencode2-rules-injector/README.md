# OpenCode2 Rules Injector QA Evidence

Date: 2026-08-14 | Branch: `feat/oc2-rules` | Base: `dev` at `3bb99a91f`

## WHAT WAS TESTED

The OpenCode2 adapter now adds project instruction context through its existing
`session.hook("context")` composer. The adapter reuses
`@oh-my-opencode/rules-engine` for project-root detection, rule discovery,
static matching, ordering, formatting, truncation, and AGENTS.md walk-up.

Verification covered:

- TDD RED: the composer did not append project context and the adapter module
  did not exist. `out/tdd-red.txt` records `12 pass`, `2 fail`, and `1 error`.
- TDD GREEN: focused loader and composer tests reached `15 pass`, `0 fail` in
  `out/tdd-green.txt`.
- Package gate: `bun test packages/omo-opencode2/src` reached `110 pass`,
  `0 fail`, and `316 expect()` calls in `out/unit-tests.txt`.
- Type safety: `bun run typecheck` exited `0`; the complete command chain is in
  `out/typecheck.txt`.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` version
  `0.0.0-next-17055` with `zhipuai/glm-4.7` in isolated present and absent
  project fixtures.

## WHAT WAS OBSERVED

`out/qa-summary.txt` ends with `summary: PASS=5 FAIL=0`.

- Present fixture: one always-apply `.omo/rules/*.md` file plus root
  `AGENTS.md` produced one `omo.context.rules` trace event with
  `injected=true`, `ruleFiles=1`, `agentsFiles=1`, `systemParts=2`, and
  `diagnostics=0`. See `out/trace-check-present.txt`.
- Absent fixture: no project rules and no `AGENTS.md` produced one trace event
  with `injected=false`, `ruleFiles=0`, `agentsFiles=0`, `systemParts=0`, and
  `diagnostics=0`. See `out/trace-check-absent.txt`.
- Isolation: `out/isolation-violations.txt` is empty. The newer-than-marker
  sweep found no writes to the host OpenCode stores.
- Composer order: unit coverage proves project context is inserted after the
  live skill and command catalogs and before the final keyword-mode system
  part. No second context hook or parallel context system was added.
- Matching: unit coverage includes an always-apply rule and a glob-only rule.
  The always-apply rule is injected at prompt time; the target-specific rule is
  not treated as globally applicable.

## WHY IT IS ENOUGH

The real-binary assertions use `OMO_SPIKE_TRACE` rather than CLI prose. The CLI
summarizes tool and model activity and does not expose raw system parts, while
the distinct `omo.context.rules` event is emitted from the exact context hook
that mutates the model request.

Both directions are first-class checks. The present case would fail if either
rules or AGENTS.md disappeared, and the absent case would fail if the hook
always appended a placeholder or leaked user-home rules. Together they
distinguish conditional project discovery from unconditional hook firing.

The package suite covers the adapter's existing context composition and the
new rule loader in-process. Root typecheck covers the workspace dependency and
all package boundaries. The real surface then proves the pinned OpenCode2
binary loads the TypeScript plugin and observes the same behavior.

## WHAT WAS OMITTED

- The CLI transcript is retained as `out/run-present.txt` and
  `out/run-absent.txt`, but it is not used as injection proof because the CLI
  does not print raw system context.
- User-home rules are deliberately excluded from this project-context port.
  This prevents host configuration from entering isolated project requests and
  makes the absent fixture a strict zero-source case.
- Target-specific dynamic rules are not promoted to static prompt context.
  `rules-engine` only selects `alwaysApply` and single-file rules when there is
  no target path. The unit test pins this matching behavior rather than
  bypassing it by injecting every discovered file.
- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed.
- `models.json` is excluded from the host-store sweep for the same reason as
  the proven tool-guard QA: OpenCode2 owns that provider catalog and the plugin
  does not write it.
- The known Windows `spawn-with-timeout.test.ts` failure was not run or changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
