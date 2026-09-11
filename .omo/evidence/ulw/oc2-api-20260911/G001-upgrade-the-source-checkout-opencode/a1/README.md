# OpenCode2 API upgrade evidence

## Outcome and scope

The source-checkout adapter now targets `@opencode/plugin` and `@opencode/schema` `0.0.0-beta-19425`, matching the installed OpenCode2 host. It retains the Promise API, existing feature gates and source-only installation. No DAG port, Effect rewrite, npm payload expansion, global installation or real user configuration change is included.

The installer resolves the existing `packages/omo-opencode2/src` directory and migrates matching old `index.ts` entries in place. Native `plugins` strings/objects and legacy `plugin` strings/tuples retain unrelated entries, options and JSONC comments. Duplicate unconfigured entries collapse to the configured entry; multiple configured OMO entries fail closed rather than choose between user options.

Commands register executable callbacks. Each explicit invocation submits one awaited native prompt, preserving delivery and attachments. Agent-targeted commands resolve the agent at invocation time, switch the agent if needed, and apply its configured model/variant. Argument substitution is one-pass and never executes argument-supplied shell syntax. Both dispatch audits document the precise native-command exception; automatic observed-edge continuations keep their existing gate.

## What was tested / observed

The matrix below records the initial verification. Gate review subsequently found that its installer helper bypassed the production installer and that it did not execute task delegation. See `review-round-1.md`; the 29-check receipts are not complete delivery proof. Remediation and refreshed coverage are recorded separately below before final approval.

| Surface | Command or action | Observation | Artifact |
| --- | --- | --- | --- |
| Original failure | New isolated driver against unmodified adapter and installed beta-19425 | File entry rejected; directory entry reaches missing command draft.update; native CLI still exits 0 but OMO tools are absent | `loader-red/receipt.json`, `old-file.log` and `old-command.log` inside that directory |
| Command API regression | Add-only editor fixture before migration | TypeError at the real old registration call, not an import failure | `command-editor-red.log` |
| Installer regression | New migration tests before fix | Exit 1 for directory return, legacy migration, duplicate/options and malformed legacy cases | `installer-red.log` |
| Installer final | Resolver, config writer and installer tests | 22 pass, 0 fail | `installer-green.log` |
| Adapter final | `bun test packages/omo-opencode2/src` | 374 pass, 0 fail | `adapter-tests.log` |
| SDK compatibility | Pinned package install, affected suites and strict fixture compilation | 343 affected tests pass; nullable compaction text accepted without changing goal behavior; unrelated lock entries including zod 4.4.3 preserved | `sdk/README.md` and its logs |
| Full typecheck | `bun run typecheck` | Exit 0 | `typecheck.log` |
| Full build | `bun run build` | Exit 0; root test command ran afterward | `build.log` |
| Root audit RED | First full `bun test --timeout 20000` | One failure naming the new explicit-command route in the second, repository-wide audit | `root-tests.log` |
| Root final | `bun test --timeout 20000` after exact audit registration | 18,627 pass, 40 existing skips, 0 fail, 18,667 tests across 2,361 files | `root-tests-final.log` |
| Real beta-19425 HTTP | `node packages/omo-opencode2/scripts/qa-api-upgrade.mjs <fresh-evidence-dir> --installer` | All 29 assertions pass on actual host, not substituted adapter logic | `live-final/assertions.json`, `live-final/receipt.json` |
| Real CLI through tmux | Same installer-backed driver entered in owned `oc2-api-qa` terminal | All 29 assertions pass, TMUX_QA_EXIT=0; terminal then removed | `tmux-cli/transcript.txt`, `tmux-cli/receipt.json` |
| Adjacent v1 host | `bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test` | v1.18.30 healthy, 162 documented paths, unauthenticated API 401; helper owns isolated sandbox/cleanup | `v1-server-smoke.log` |

The final command, renderer and installer test files also passed explicit strict `tsgo` compilation with `--ignoreConfig --noEmit --strict --skipLibCheck --target esnext --module esnext --moduleResolution bundler --types bun-types`.

## Why the live proof is sufficient

The driver starts the installed host with authenticated `serve --stdio --port 0` on loopback and invokes its real `/api/session/:id/command` endpoint. A stock QA-only command proves transport independently. `/goal` preserves literal dollar tokens and current agent/model; `/ulw-execute` changes a Sisyphus/gpt-fake session to Atlas/gpt-atlas and that different model receives the actual request. The driver checks durable user messages and model requests, not just registration prose.

The mock requests native `read`, writes a pending todo, then clears it. Tool results return to the model with hashline tags; todo context appears and disappears. Base OMO tools remain present and all 19 goal/monitor/team gated tools are present only in the enabled fixture. Production trace confirms registration, read tagging, todo writes and context composition. Missing/malformed commands return 404/400 without user-message admission; missing API credentials return 401.

## Isolation and cleanup

Both final receipts compare real host config digests and session/session_v2 counts before and after. Each fixture supplies isolated HOME, USERPROFILE, PWD, OPENCODE_TEST_HOME and all four XDG roots. Credentials are local fake model keys and ephemeral server credentials, not user provider keys. All owned host processes closed, mocks closed and temporary sandboxes were removed. The lead killed the dedicated `oc2-api-qa` tmux session after reading its successful output. Other existing terminal sessions were not touched.

## Limitations and omitted material

- Configured TypeScript LSP initialization fails because workspace TypeScript 7.0.2 has no `tsserver.js`; attempts were made on changed files. Native `tsgo` is the successful typecheck fallback; no suppressions or server installation were used. Markdown has no configured LSP.
- v1 smoke proves adjacent host health, not OMO v1 hook behavior. Changed installer behavior is proven separately by its real resolver/writer followed by actual v2 host loading; no v1 runtime hooks changed.
- Real-provider quality, every optional feature's full lifecycle, Windows execution, and newer unpinned betas are not claimed. This fixes and verifies the specified beta-19425 compatibility boundary.
- Initial QA driver probe failures remain in `command-driver-probe-*` and are labeled RED; the final passing receipts supersede them. The installer worker timed out after PIN with no production edits; the lead completed its migration. A failed task is not counted as a pass.
- No auth headers, real credentials or inherited environment dumps are included. Captured prompts and paths belong to synthetic QA fixtures; the terminal capture is CLI-output evidence, not visual layout QA.

## Review and delivery

At capture: local gates and lead real-surface QA pass; one gate review and PR CI/merge remain pending. Source namespace migration changes imports mechanically across the adapter; command registration is its coupled behavioral API change. Installer migration, its resolver, QA runner, documentation and evidence are separate reviewable concerns.

## Gate-review remediation and final verification

The three findings in `review-round-1.md` were addressed:

- `runOpenCode2Installer()` now calls the shared source-directory resolver and rejects absent source before either config writer. Its former independent package/file fallback was removed. The QA process now invokes this production function, checks its output config, and repeats the full installer to prove idempotence. Fixture MCP entries are explicitly user-disabled before installation; the installer preserves them, so unrelated external MCP services are not contacted. Fresh-config MCP insertion remains covered by the production installer test.
- `registerConfiguredAgents()` reads `agent.list()` before constructing snapshots. That forces deferred transforms, including the base Sisyphus prompt capture. Dispatch model choices come from the materialized records, preserving configured direct/category models instead of recomputing defaults. The index no longer treats reload as a barrier. Four deferred tests fail before the fix and pass afterward (`review-fix-lazy/red.log`, `review-fix-lazy/registration-tests-final.log`).
- Decoded file URL paths are normalized before equality comparison. A trailing-slash directory URL followed by a configured old entry now leaves one entry with its options. The production-installer and overlap regressions are RED in `review-installer-red.log` and GREEN in `review-installer-green.log` (25 pass).

Final local commands after those fixes:

| Command | Result | Artifact |
| --- | --- | --- |
| `bun run typecheck` | Exit 0 | `typecheck-review-final.log` |
| `bun run build` | Exit 0 | `build-review-final.log` |
| `bun test --timeout 20000` | 18,634 pass, 40 existing skips, 0 fail; 18,674 tests across 2,361 files | `root-tests-review-final.log` |
| Production-installer-backed real HTTP QA | 33/33 assertions pass | `review-live/receipt.json` |
| Same final QA through owned tmux terminal | 33/33 assertions pass and TMUX_QA_EXIT=0 | `review-tmux-final/receipt.json`, `review-tmux-final/transcript.txt` |

The four added live rows actually execute OMO `task`: direct `explore` and category `quick`, in both enabled/disabled fixtures. The configured child models (`gpt-explore` and `gpt-quick`) make real mock-provider requests and their distinct answers return through the task tool to the parent. Trace verifies nonempty registration catalogs, successful task completion and Sisyphus rebaking, while Atlas is not rebaked. This closes the visibility-only gap rather than replacing it with another registration assertion.

Both refreshed receipts certify unchanged real host configurations and session counts, closed host processes/mock and removed sandboxes. The lead read the successful tmux output and removed only `oc2-api-review-qa`. The delta gate review returned APPROVE with high confidence (`review-round-2.md`). GitHub delivery remains pending at capture.
