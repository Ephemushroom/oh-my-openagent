# Agent source lane evidence

Worktree: oh-my-openagent-sync-20260910, branch sync/upstream-20260910.
Inputs: fork HEAD 51829514e; upstream MERGE_HEAD cb3d88e9.
Scope: packages/agents-core/** and packages/omo-opencode/src/agents/** only.

## Resolution rationale

All eleven original unmerged paths are resolved and staged. No commit, push, merge, rebase, dependency installation, root-manifest edit, or OpenCode2 edit was performed by this lane.

| Conflicted adapter path (under packages/omo-opencode/src/agents/) | Resolution |
| --- | --- |
| types.ts | Keep the fork's core type/model re-exports and OpenCode-only config types. Add isGpt6Model to the re-export list; implement the upstream detector in agents-core/src/types.ts. |
| gpt-prompt-identity.ts | Keep core re-export shim; port upstream Astra identity key, label, and model detection to core. |
| hephaestus/agent.ts | Keep the core-backed OpenCode factory; port upstream GPT_6_RE support and GPT-5.6 prompt-family selection to core hephaestus/prompt-router.ts. |
| sisyphus-junior/agent.ts | Keep override/permission factory and core prompt builder; port GPT-6 selection to core sisyphus-junior/prompt-router.ts. |
| oracle.ts | Keep core selection plus adapter permissions/config; core specialists/oracle-prompt.ts now selects the existing GPT-5.5 prompt and xhigh/high tuning for GPT-6, as upstream does. |
| momus.ts | Keep core selection plus adapter permissions/config; core specialists/momus-prompt.ts now selects the existing GPT-5.6 prompt and high/high tuning for GPT-6, as upstream does. |
| librarian.ts | Keep core-backed factory; move upstream Context7 query-docs tool spelling and malformed table-row removal into core specialists/librarian-prompt.ts. |
| dynamic-agent-category-skills-guide.ts | Keep re-export shim; core receives upstream background-by-default examples plus updated visual/deep domain guidance. Only typography differs: ASCII hyphens instead of the upstream em dashes. |
| sisyphus/default.ts | Keep shim; core receives both background-by-default continuation examples. |
| sisyphus/gemini.ts | Keep shim; core receives background-by-default feature-delegation example. |
| sisyphus/gpt-5-5.ts | Keep shim; core receives upstream background spawn guidance and Oracle dependency discipline. |

No new source prompt/router file is required. Upstream intentionally routes GPT-6 into existing GPT-5.5/5.6 families. The adapter sisyphus-agent-factory.ts and frontier-tool-schema-guard.ts automatically merged upstream GPT-6 support and consume the newly exported detector. Automatically merged atlas/prompt-section-builder.ts and builtin-agents/available-skills.ts changes were retained. All upstream tests were retained without edits or suppressions.

The merge automatically propagated two extracted files correctly: agents-core/src/sisyphus-dynamic-prompt-execution.ts and agents-core/src/sisyphus-junior/gpt-5-5.ts. Their upstream background guidance was reviewed and left intact.

## Changed paths beyond the automatic merge

Unstaged core implementation changes:
- packages/agents-core/src/types.ts
- packages/agents-core/src/gpt-prompt-identity.ts
- packages/agents-core/src/hephaestus/prompt-router.ts
- packages/agents-core/src/sisyphus-junior/prompt-router.ts
- packages/agents-core/src/specialists/oracle-prompt.ts
- packages/agents-core/src/specialists/momus-prompt.ts
- packages/agents-core/src/specialists/librarian-prompt.ts
- packages/agents-core/src/dynamic-agent-category-skills-guide.ts
- packages/agents-core/src/sisyphus/default.ts
- packages/agents-core/src/sisyphus/gemini.ts
- packages/agents-core/src/sisyphus/gpt-5-5.ts

New, untracked regression: packages/agents-core/test/gpt-6-routing.test.ts.
Of the eleven staged conflict resolutions, only adapter types.ts differs from the fork HEAD. The other ten preserve the fork's original shims/factories because the upstream behavior now lives in core.

## Verification commands and observed output

1. RED: from the approved temp directory, run `bun test <worktree>/packages/agents-core/test/gpt-6-routing.test.ts` before the core port:
   - 1 pass, 15 fail, 13 expect() calls, 16 tests.
   - Three provider fixtures each reproduced: identity gpt-family instead of gpt-6-astra; Hephaestus UnsupportedHephaestusModelError; Junior gpt instead of gpt-5-5; Oracle medium instead of xhigh; Momus medium instead of high.
   - The unchanged GPT-5.6 identity case passed.
   - Running from temp avoids the repository-wide test preload while the adapter/core exports are being reconciled. Earlier root-preload attempts failed on conflict syntax and missing isGpt6Model, not behavior; these were not counted as RED proof.
2. GREEN: same isolated core command after port: 16 pass, 0 fail, 16 expect() calls, 28 ms.
3. From the worktree, `bun test packages/agents-core/test`: 37 pass, 0 fail, 55 expect() calls across 5 files, 520 ms. Includes the harness-coupling audit (no @opencode-ai imports in core).
4. From the worktree, `bun test packages/omo-opencode/src/agents`: 294 pass, 0 fail, 801 expect() calls across 26 files, 621 ms.
5. `bun run --filter @oh-my-opencode/agents-core typecheck`: exit 0.
6. `bun run --filter @oh-my-opencode/omo-opencode typecheck`: exit 1, only these out-of-scope errors:
   - src/cli/install-opencode2.ts(2,10): TS2305, @oh-my-opencode/utils has no exported member resolveCodegraphCommand.
   - src/cli/install-opencode2.ts(2,35): TS2305, @oh-my-opencode/utils has no exported member buildCodegraphEnv.
7. `lsp_diagnostics` attempted individually on all 23 files manually edited/created (eleven conflict paths, eleven core sources, new regression). Every initialization failed with the same environment error: TypeScript 7.0.2 at worktree/node_modules/typescript/lib provides no tsserver.js; no other valid TypeScript installation found. This is not a clean-diagnostics claim.
8. Programming skill check-no-excuse-rules.ts run on the eleven changed core sources plus new regression: `No violations in 12 file(s).`
9. `GIT_MASTER=1 git diff --check -- packages/agents-core packages/omo-opencode/src/agents` and its `--cached` counterpart: exit 0, no output.
10. `GIT_MASTER=1 git diff --name-only --diff-filter=U -- packages/agents-core packages/omo-opencode/src/agents`: exit 0, no output after staging the eleven resolved paths.

## Sufficiency and remaining work

The regressions assert routing identifiers and tuning fields, not prompt prose. Existing adapter tests exercise the retained factory/config surface; the core audit confirms harness neutrality. Existing prompt data modules stay intact rather than being refactored during a merge. No new abstraction, runtime trust boundary, logger, error suppression, or external dependency was added.

Lead still owns full harness QA and whole-merge typecheck/build. The opencode-qa router maps this lane to isolated agent registration/config inspection and an agent invocation; this lane does not claim live harness QA. Fix/remove the CodeGraph installer imports in the lead-owned integration scope, then rerun adapter typecheck. LSP requires a TS7-compatible server or a compatible tsserver installation, not source suppression.

No secrets, environment dumps, credentials, or host session data were collected. This report is outside the repo to respect the exclusive source-lane ownership; lead should place it under .omo/evidence/20260910-upstream-sync-codegraph/ with the full integration evidence.
