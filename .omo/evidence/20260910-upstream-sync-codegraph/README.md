# Upstream sync and CodeGraph removal

Status: implementation, local validation and Oracle gate review complete; PR checks and merge pending.

## Scope

- Fork base: `51829514e7508ccd61891b97aa2d712238f3b6f6`.
- Upstream: `cb3d88e9c93c439e1511bedde44c5533d881dfbb` (beta.52).
- Import upstream history, retain native OpenCode2 and agents-core extraction, retain fork slim CI, remove built-in CodeGraph as explicitly requested.
- No new DAG or Effect integration.

## Merge resolution ledger

- A fresh worktree initially appeared dirty because two committed ANSI terminal captures contain bytes which conflict with the generic `*.txt text eol=lf` rule. Marking historical `terminal-ansi.txt` evidence as `-text` preserved their bytes and allowed the normal merge. This is a normalization-only prerequisite, not a behavior change.
- Root and OpenCode package manifests retain fork workspace registrations and agents-core dependency, while accepting upstream dependency versions. The root release version comes from upstream; no local release bump was authored.
- Bun 1.4.2 regenerated the conflicted lockfile during `bun install --ignore-scripts`; 590 packages installed. Prepare scripts were deferred while source conflicts remain. Range resolutions can differ from upstream's older lock and are included in validation scope.
- CodeGraph installer test deletions follow upstream `e5ab78a2d` (remove CodeGraph). The fork's only modifications were removal of invalid triple-slash references.
- Five old builtin-skill test deletions follow upstream `9ab0a28d6` (complete extraction to skills-loader-core). Their destination tests remain under `packages/skills-loader-core/src/features/builtin-skills/`; no failing behavioral test was discarded.
- `bun run build:codex-install` regenerated the conflicted installer bundle from merged source successfully.

## Verification limitations observed so far

- JSON LSP: Biome is not installed and installation was previously declined.
- TypeScript LSP: the installed upstream TypeScript 7.0.2 package has no tsserver.js, so the configured language server cannot initialize. Use the repository's native `tsgo` typechecks rather than claiming clean LSP diagnostics.

## Evidence policy

Record each command, observed result, isolation proof and residual risk below as work completes. Do not include provider credentials, raw private host config, auth stores, environment dumps or secret-bearing transcripts. Historical evidence is not a substitute for a live run against this merged source.

## Integration results

- `typecheck.log`: root, script and package checks completed with no diagnostics after removing the remaining CodeGraph installer imports and correcting a test TOML table type to match its record validator.
- `build.log`: full build completed. The first regenerated lock selected Zod 4.6.1, causing the Senpi bundle to exceed its unchanged 1,100,000-byte budget. Restoring upstream's locked Zod 4.4.3 through Bun (while retaining upstream's `^4.4.3` manifest range) fixed the bundle check; no size ceiling was raised.
- `targeted-tests.log`: 704 passing native OpenCode2, agents-core and DAG tests, no failures.
- `installer-codegraph-red.log`: after the upstream-removed import was reconciled, the removal regression failed on `not.toThrow` with `codegraph not available`. `installer-codegraph-green.log`: all 8 installer tests pass after removal. Temporary mock scaffolding was removed; final tests use real modules.
- `schema-gate-red.log`: missing post-build freshness check failed both assertions. `merge-followup-green.log`: 31 passing schema-gate and Codex TOML tests after adapting freshness enforcement to the fork test-prerequisite build.
- `root-tests.log`: initial full run had 18,601 passes and three failures. Follow-up fixes preserve the policy assertions while accommodating the separately tested schema gate, restore upstream Zod resolution, and reset every telemetry opt-out input before each env-matrix test. `root-followup-green.log` passes those focused checks. The final full-suite result is recorded below.

## Real-surface QA

- `qa-opencode.mjs` runs actual CLI processes against a loopback Responses API mock, with isolated HOME/XDG roots and no user provider credentials. It exercises help, invalid flag rejection, enabled and disabled configurations, and records mock request tool names. Each run tears down its process group, HTTP mock and sandbox; host session-table counts and global config hash must remain equal.
- `opencode2-pinned-driver.log` and `opencode2-pinned-receipt.json`: PASS against beta-17823, the binary documented as matching the adapter's beta-17793 plugin API. Both cases materialize Sisyphus; enabled configuration contains Context7/grep_app while disabled configuration contains none; CodeGraph is absent even with a stale config block. LSP is disabled in this live scenario to avoid unrelated daemon startup; its registration remains covered by unit tests.
- `opencode-driver.log` and `opencode-receipt.json`: PASS against the real v1 CLI. Model request tool lists contain OMO background/session tools; the enabled run exposes Context7/grep_app tools and the disabled run does not.
- `codex-live.log`: PASS. Actual isolated Codex app-server completed a mock-backed turn with plugin `hook/started` and `hook/completed` notifications for SessionStart and UserPromptSubmit, with no missing or failed hooks.
- Senpi Linux live QA and final Oracle gate review passed as recorded below.

## Explicit runtime-version limitation

The user's installed OpenCode2 beta-19425 is newer than this fork's pinned API. Live attempts first proved it rejects configured file paths (requires a source directory), then proved it disables this adapter at command materialization because `draft.update` no longer exists. See `opencode2-enabled.log` and `opencode2-enabled-trace.ndjson`; these are FAILED compatibility probes, not passes. The sync deliberately does not broaden into a newer OpenCode2/Effect API migration. The pinned binary passes; upgrading the adapter to the installed binary remains separate work.

The beta-17823 QA binary was downloaded from `@opencode-ai/cli-darwin-arm64@0.0.0-beta-17823`. Its tarball SHA-512 matched the registry integrity `10vuMRIVxzOw/wy/ikyOQbjotPSAGsV95S1YMqy+BFRPSlvAcppBjXGRbguPsqctsIniRh/rQkJMbjLLK83hQA==`. It was not installed globally.

## Resource receipts

- Both temporary gate monitors were stopped through `monitor_stop` (`mon_d9b7a0df`, `mon_acac20c1`); their interrupted launches are not gate evidence.
- The initial tmux CLI driver session exited; the server reported no remaining session. Subsequent CLI drivers directly awaited their real child process exits.
- All OpenCode QA receipts report `sandboxRemoved: true` and `mockClosed: true`. The Codex helper owns cleanup via its EXIT trap.
- The task-downloaded beta-17823 binary directory and archive were removed after successful QA. OrbStack was started only to run the Linux check, then quit after Docker reported no running containers. Docker's cached base image was retained; no QA container remains.

## Final validation matrix

| Scenario | Command / surface | Observed | Artifact |
| --- | --- | --- | --- |
| Full build | `bun run build` | Exit 0 after restoring upstream Zod resolution | `build-final.log` |
| Root tests | `bun test --timeout 20000` | Exit 0; 18,604 pass, 0 fail; 18,644 tests including 40 existing skips | `root-tests-final.log` |
| All typechecks | `bun run typecheck` | Exit 0 | `typecheck-final.log` |
| Senpi package gate | `bun run test:senpi` | Exit 0; 3,129 pass and 32 existing skips, plus 10 evidence-resolver tests | `senpi-gate.log` |
| Native OpenCode2 | `QA_OPENCODE_BIN=<verified beta-17823 binary> QA_PLUGIN_FILES=1 QA_LABEL=opencode2-pinned node .omo/evidence/20260910-upstream-sync-codegraph/qa-opencode.mjs opencode2` | Both configurations pass; real model requests contain OMO task/background/session tools; host counts and config unchanged | `opencode2-pinned-receipt.json`, `opencode2-pinned-*-trace.ndjson` |
| OpenCode v1 | `node .omo/evidence/20260910-upstream-sync-codegraph/qa-opencode.mjs opencode` | Both configurations pass; OMO tools reach the mock-backed model; host counts/config unchanged | `opencode-receipt.json` |
| Codex app-server | `REPO_ROOT=<worktree> bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin` | Real turn and all required plugin hook notifications pass | `codex-live.log` |
| Senpi live Linux | Existing `drive.mjs` in an ephemeral Linux container with the rebuilt local plugin | PASS; isolationCertified, realHomeIsolationCertified, realSenpiUntouched, realOmoUntouched all true | `../omo-senpi-adapter/20260910-upstream-sync/drive-linux.json` |
| Codex no-Bun runtime branches | Unmodified `install-bin-links.test.mjs` in the same Linux container, where Bun is genuinely absent | 21 pass, 0 fail, 0 skipped | `../omo-senpi-adapter/20260910-upstream-sync/codex-bin-links-linux.log` |

### Local Codex gate caveat

`PATH=/opt/homebrew/opt/python@3.13/libexec/bin:$PATH bun run test:codex` still exits 1 on this Mac: its Node suite reports 493 pass and three failures in `install-bin-links.test.mjs`. All three declare that Bun is absent everywhere, but the production wrapper correctly discovers this machine's `/opt/homebrew/bin/bun`, outside the fixture PATH/HOME. The unchanged 21-test file passes in Linux with no global Bun (including all three failures), so neither the production search behavior nor its assertions were weakened. The initial 25 missing-tomllib failures were resolved by using the already installed Python 3.13 instead of Apple's Python 3.9. This is not a claim that the aggregate macOS Codex command exited 0.

### Linux isolation boundary

The worktree was streamed with `tar --exclude=node_modules --exclude=.git --exclude=.omo/evidence --exclude=.codegraph -cf - .` into `docker run --rm --name omo-sync-linux-qa -i`, using `node:24-bookworm-slim`. The only bind mount was the resolved Senpi evidence directory at `/evidence`. No real home, credentials, Docker socket, or writable source checkout was mounted. Inside the container, the snapshot was extracted to `/workspace`; `npm install --prefix /runtime --no-audit --no-fund @code-yeongyu/senpi@2026.9.10 @code-yeongyu/comment-checker@0.8.0` supplied Linux runtimes; `NODE_PATH=/runtime/node_modules`, `PATH=/runtime/node_modules/.bin:$PATH`, and `SENPI_BIN=/runtime/node_modules/.bin/senpi` drove the existing Senpi driver and unmodified Codex bin-link tests. The container exited 0 and was removed by `--rm`; installation/driver output is in the Senpi `container.log`.

The macOS Senpi probe's functional result was PASS, but its Linux-only directory-identity certification was false. That result is retained in `drive.json` and is superseded for isolation certification by `drive-linux.json`, not relabeled as a pass.

## Gate-review remediation

The first Oracle review rejected the checkout-free PR-target job's call to the repository-local summary script. `review-guard-red.log` reproduces both dev and master summary failures (exit 127) by executing the real workflow commands from an empty directory. The summary now uses inline `printf` with inputs passed through environment variables; the privileged job still does not check out source. `review-guard-green.log` records 31 passing guard/summary/schema/installer tests, `review-script-typecheck.log` passes, and `review-actionlint.log` contains no diagnostics.

The installer notice no longer advertises CodeGraph. `installer-live-positive.log` records a real isolated `runCliInstaller` call followed by an idempotent `runOpenCode2Installer` call: only the available supported MCPs are present, no CodeGraph, one plugin entry, no repeat rewrite. The initial missing-config run (`installer-live.log`) verifies the existing fail-closed path; the successful run seeds an empty config first and compares canonical paths on macOS. Both temporary roots were removed. This proves config generation, not acceptance of the older installer config shape by beta-19425.

The second Oracle review returned APPROVE with high confidence after reading the inline-summary implementation, empty-directory regression, RED/GREEN artifacts, actionlint/typecheck results and isolated installer receipt. No blocking issue remained. The final notice-only rebuild and full root suite were then rerun successfully (`build-final.log`, `root-tests-final.log`). No review or required-check override will be used.
