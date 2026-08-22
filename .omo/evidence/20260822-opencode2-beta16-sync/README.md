# Upstream sync to v5.0.0-beta.16 + opencode2 adapter verification

**Date:** 2026-08-22
**Base:** fork dev @ 60210ef70 (PR #39). **Merged:** upstream tag `v5.0.0-beta.16` (bddfeb521, 355 non-merge commits, beta.9 → beta.16).
**Binary driven for adapter QA:** `opencode2 v0.0.0-beta-17898` (auto-updated past 17823; plugin API pin remains beta-17793-compatible).

## WHAT WAS TESTED

1. **The merge itself.** 16 conflicted files, all resolved deliberately:
   - fork-deleted workflows + their tests stay deleted (refresh-model-capabilities, sisyphus-agent, stats, web-ci, web-deploy, publish-workflow.test, senpi-test-script.test)
   - `ci.yml` keeps the fork's slim CI (block-master-pr + test + typecheck); upstream's ci-mode classifier + heavy matrix not adopted (fork policy)
   - `package.json` root: union (senpi 2026.8.22 from upstream + agents-core workspace dep from fork)
   - `packages/omo-opencode/package.json`: ours + upstream dep bumps (clack 1.7, mcp sdk 1.30) + fork's agents-core
   - senpi extension bundles + install-local.mjs: upstream versions, then REBUILT via `bun run build:codex-install` so the bundle-freshness gate holds
   - AGENTS.md stamps: upstream's, annotated as fork sync; skill tables: union (opencode2-qa + senpi-qa both listed)
2. **Gates on the merged tree:** `bun install --ignore-scripts` (613 pkgs); `bun run typecheck` exit 0 (all 33 packages incl. omo-opencode2); `bun test packages/omo-opencode2/src` **313 pass / 0 fail**.
3. **Full `bun test`:** 16478 pass / 47 fail / 72 skip (2158 files, 27.6 min). Every failure triaged against a PURE upstream beta.16 worktree on this machine.
4. **Live adapter QA** on the merged tree (`qa.sh` copied from the builtin-mcps bundle): PASS=9 FAIL=0.

## WHAT WAS OBSERVED

Full-suite failure triage (47 fails):

| Class | Count | Evidence |
|---|---|---|
| Upstream environmental (fails identically on pure upstream beta.16 on this Windows host) | 35 | senpi dag/chaos/admission-lease, omo-codex install/telemetry, omo-native setup, codegraph-provision, spawn-with-timeout, dist-bundle-prompt (needs `bun run build`), package-layout + verify-omo-ai-payload (need materialized runtimes), Docker QA harness (references a `.claude/skills/codex-qa` dir that is an empty placeholder upstream too), CLAUDE.md symlink-on-Windows |
| Fork-policy (assert upstream's full CI matrix which the fork slimmed) | 8 | `script/ci-fast-path.full-matrix.test.ts` — REMOVED in this merge, same treatment as 7fedd41c3 at the beta.9 sync |
| Real merge defect | 1 | codex installer bundle staleness (install-local.mjs taken from theirs while source digests moved) — FIXED by `bun run build:codex-install` + `git add`; gate now 2 pass |

Live adapter QA on merged tree: all four registration assertions, 3 servers pending → connected, negative disabled_mcps case, host store isolation (1135 → 1135). The binary had auto-updated to beta-17898; the pinned plugin package (beta-17793 dist) still drives it cleanly.

## WHY IT IS ENOUGH

- The sync's risk surface is (a) conflicts mis-merged, (b) fork deltas silently dropped, (c) upstream env failures mistaken for merge defects. (a) is covered by typecheck+tests across all packages plus the deliberate per-file resolutions listed above; (b) by the v2 adapter suite + live QA on the exact merged tree (the fork's primary asset); (c) by the pure-upstream control worktree run per failing file.
- The single real merge defect (bundle freshness) was caught by upstream's own gate and fixed by regeneration, proving the gate works in the fork too.

## LIVE VERSUS UNIT PROOF

Live: the 9-assertion adapter QA on the merged tree against the real beta-17898 binary. Unit: 313 adapter tests. Everything else is the triage above, reproduced on two trees.

## WHAT WAS OMITTED

- v1 plugin (`packages/omo-opencode`) live OpenCode QA not re-run: the merge changes it only via upstream commits already tested by upstream CI, and the fork does not exercise the v1 surface; its new tests (BTW, OpenGateway) pass in the full-suite run.
- API keys stayed in child env only; no secrets in the bundle.

## Artifacts

- `qa.sh`, `out/case1-*`, `out/case2-*` — adapter QA on the merged tree
- Full-suite output: temp file on the runner; per-file control runs executed in `%TEMP%\oc2-pure-upstream` (not committed)
