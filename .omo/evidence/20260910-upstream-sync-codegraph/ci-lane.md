# CI lane merge resolution

## Scope and source evidence

- Worktree branch: `sync/upstream-20260910`; existing merge, no new merge/rebase/commit/push performed by this lane.
- Compared `git show HEAD:.github/workflows/ci.yml` with `git show upstream/dev:.github/workflows/ci.yml` at the lead's pinned upstream `cb3d88e9`.
- Fork policy comes from `b8d1f7044` (slim fork CI) and `b0b711c61` (60-minute serial root-suite budget).
- Actual upstream CI uses Bun **1.4.2**, Node **24**, checkout/setup-node **v7**, cache **v6**, and POSIX `bun test --timeout 20000`. The older Bun 1.4.0 statements in AGENTS are stale.
- The existing `.gitmodules` lists four public HTTPS frontend sources. Both Linux checkouts initialize these recursively. Dependency install ignores lifecycle scripts; the test job explicitly runs `bun run build` before the suite, preserving build prerequisites without an implicit install-time build.

## Edited paths and retained contracts

| Path | Resolution |
| --- | --- |
| `.github/workflows/ci.yml` | Only `block-master-pr`, Linux `test`, Linux `typecheck`; read-only global contents permission; 60-minute serial suite; upstream runtime/action pins and 20-second test timeout; explicit prerequisite build and stale self-copy cleanup; summaries for all jobs. |
| `script/fork-workflow.test.ts` | New parsed-YAML policy gate: exact four workflows, automatic CI/lint only, manual/call-only publication, exact slim Linux jobs, runtime/preparation order. Executes the real master-PR shell guard with a local `gh` stand-in for both master rejection and dev acceptance. |
| `script/ci-fast-path.full-matrix.test.ts` | All classifier process execution scenarios retained. Removed only workflow wiring for absent `ci-mode` and OS matrices. |
| `script/ci-job-summary-workflow.test.ts` | Expected workflow/job inventory now matches four retained workflows. Summary writer execution, discovery, and privileged input handling tests retained. |
| `script/ci-root-test-partition.test.ts` | Removed absent OS-matrix invocation assertions. Retained local partition exclusions, quarantine list agreement and command generation, plus Windows telemetry privacy/exit-code source contracts. |
| `script/root-test-config.test.ts` | Removed only CI-specific partition argv assertion. Real Bun config loading and exclusion tests retained. |
| `script/senpi-test-script.test.ts` | Removed only absent dedicated Senpi CI matrix assertion and its unused slicer. Packed installer integration, build/payload contract and hermetic script ordering retained. |
| `script/publish-workflow.test.ts` | Removed absent cross-OS/Codex CI job wiring and the separate CI dist-build invocation expectation. Manual publish source/provenance/assets, package-script prerequisites, nested lockfile and Bun pin checks retained. |
| `script/agent-command-string-audit.allowlist.json` | Kept valid current entries from both sides, including `changes.md: omo doctor x2`. Removed conflict markers and upstream AGENTS/CLAUDE entries absent from actual merged scanner output. The `publish.yml` entry is valid because the manual template remains. |

`script/publish-release-platform-workflow.test.ts` resolves to upstream unchanged: its manual workflow/platform payload assertions still apply and pass. Other `publish-*workflow.test.ts` files remain unchanged. `.github/workflows/lint-workflows.yml`, `publish.yml`, and `publish-platform.yml` retain auto-merged upstream content. Publication has no push/PR/schedule trigger; no publication command was run.

## Intentional deletions

All workflow paths below are under `.github/workflows/`:

| Deleted path | Reason |
| --- | --- |
| `cla.yml` | Restores upstream CLA comment/signature automation deliberately removed by fork policy. |
| `refresh-model-capabilities.yml` | Restores scheduled upstream snapshot-refresh PR creation. Model capability tests remain. |
| `sisyphus-agent.yml` | Restores upstream secret-bearing comment-driven LLM automation. |
| `stats.yml` | Restores upstream scheduled download telemetry. Stats implementation/tests remain. |
| `web-ci.yml` | Restores an independent upstream marketing-site CI gate. |
| `web-deploy.yml` | Restores upstream Cloudflare deployment automation. |
| `compiled-worker.yml` | Adds an unrelated Senpi compiled-worker OS matrix. Compiler behavior tests remain untouched. |
| `review-claims.yml` | Adds upstream label/reviewer mutations and an hourly sweep, outside slim fork CI. |
| `bot-merge.yml` | Adds upstream-owner/PAT-specific merge automation, not a fork requirement. |
| `npm-dist-tag-rollback.yml` | Adds upstream registry mutation operations; fork does not publish. |
| `windows-flake-soak.yml` | Adds a Windows/Senpi-only diagnostic dispatcher tied to upstream Windows shards absent in the fork. Underlying tests and telemetry helper remain. |

`package-labels.yml` was already absent and was not recreated.

Deleted test paths:

- `script/omo-ai-ci-job.test.ts`: exclusively asserts the deliberately absent native payload-publish CI job and downstream schema/release needs. No payload verifier or application behavior test deleted.
- `script/windows-flake-soak-workflow.test.ts`: exclusively asserts the deleted Windows diagnostic workflow's target/trigger/telemetry wiring. No scheduler, memory, or Windows runtime behavior test deleted.

## Verification

Runtime: `bun --version` -> `1.4.2`.

Focused command (no full suite):

```sh
GIT_MASTER=1 bun test --timeout 20000 script/fork-workflow.test.ts script/ci-fast-path.full-matrix.test.ts script/ci-job-summary-workflow.test.ts script/ci-root-test-partition.test.ts script/root-test-config.test.ts script/senpi-test-script.test.ts script/publish-workflow.test.ts script/publish-release-platform-workflow.test.ts script/publish-lazycodex-workflow.test.ts script/publish-lazycodex-sync-workflow.test.ts script/publish-gate-reuse-workflow.test.ts script/publish-post-verify-workflow.test.ts script/publish-lazycodex-version-stamp-workflow.test.ts script/agent-command-string-audit.test.ts script/agent-command-string-scan.test.ts script/ci-test-timeout.test.ts script/agent-env.test.ts
```

Captured terminal result: **96 pass, 0 fail, 456 assertions, 17 files, 13.83 seconds**. This includes executing the real summary shell writer, PR-target shell guard, classifier CLI, packed-layout installer and Bun config consumer.

```sh
bun run typecheck:script
```

Result: `tsgo --noEmit -p script/tsconfig.json`, exit 0.

```sh
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.10 -shellcheck="" .github/workflows/ci.yml .github/workflows/lint-workflows.yml .github/workflows/publish.yml .github/workflows/publish-platform.yml
```

Result: exit 0, no workflow diagnostics. Uses the same actionlint version and shellcheck setting as the retained lint workflow.

Mutation proof for the new policy test: temporarily added a valid daily `schedule` trigger to `ci.yml`. `bun test --timeout 20000 script/fork-workflow.test.ts` returned **4 pass, 1 fail**, reporting unexpected `schedule` at the trigger assertion. Removed the mutation with apply_patch and reran: **5 pass, 0 fail, 24 assertions**. Actionlint was also rerun after restoration and passed.

LSP diagnostics were attempted on all seven edited/new TypeScript files. Each failed initialization because TypeScript 7.0.2 does not ship `tsserver.js`. This is an environment limitation, not a clean LSP result; the script typecheck above passed instead. No LSP/config/dependency files were changed.

Source size check: changed TypeScript files have at most 226 nonblank lines including comments; the largest (`publish-workflow.test.ts`) is 200 lines after excluding its 26 line comments. No added runtime abstraction, tagged-variant handling, type escape hatch, or logging layer. New YAML input is parsed through Zod. Existing test bodies retained their prior conventions.

Scoped `git diff --check` passed before staging. No secrets, environment dumps, auth logs or private credentials were captured.

Final handoff: staged only owned workflow/audit paths and this evidence file. Scoped `git diff --name-only --diff-filter=U` returned no paths; scoped `git diff --cached --check` returned exit 0 with no output. No commit, push, merge, or rebase was performed.

## Lead follow-up / remaining risk

1. **Out-of-scope failing audit:** `bun test --timeout 20000 script/ci-schema-freshness-gate.test.ts` returns **0 pass, 2 fail**, both `ci.yml must define a build job`. This file was not in the assigned ownership set and is untouched. Adapt its schema gate to `test` -> `Build test prerequisites` with an explicit post-build schema diff gate, rather than restoring a separate upstream CI job or deleting behavioral schema coverage.
2. Update root/script documentation: Bun 1.4.2, no OS matrix/CI classifier/Senpi-Codex compatibility jobs or review-claim automation. The Dockerfile and container README already pin 1.4.2 from upstream.
3. Lead owns full suite/build execution and live harness QA. This lane validates workflow structure and local supporting consumers, not execution on a GitHub-hosted Linux runner. Upstream publication templates remain manual compatibility artifacts and were not exercised against registries.
4. Rerun the command-string audit after the lead finishes document edits; its exact hit counts intentionally detect wording that introduces legacy command occurrences.

Lead completion note: the handoff's schema-freshness follow-up and runtime documentation were resolved; final checks are in the parent README. The first gate review also found the checkout-free guard's summary-script dependency. That job now writes its summary inline, with empty-directory RED/GREEN proof recorded in `review-guard-red.log` and `review-guard-green.log`. The older pending statements above describe the lane handoff, not the final tree.
