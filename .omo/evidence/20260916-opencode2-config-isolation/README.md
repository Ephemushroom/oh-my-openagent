# OpenCode2 configuration isolation

## What was tested

The fork reads user `~/.omo/opencode2.json` and walked project files of the same
name, with `.jsonc` fallback. Original OMO retains `omo.json[c]`. Shared core,
v1 runtime, host configuration and installer code remain unchanged.

The initial loader regression expected `v2/model` but received `v1/model` when
both config files existed. The missing-v2 case also leaked original OMO settings.
The updated loader suite passes 14 cases / 40 assertions, including actual v1/v2
readers, original file bytes, extension selection, malformed inputs, project and
profile precedence, options, symlinks and user-only protected settings.

The combined v2 and core-loader suite passed 519 tests with zero failures.
Root typechecking and build logs are adjacent. LSP cannot initialize because TS7
lacks tsserver.js; actual tsgo provides type evidence, not a claimed LSP pass.

Final root tests: 18,720 pass, 40 existing skips, zero failures (`root-tests.log`).
Root typecheck and build passed (`typecheck-final.log`, `build-final.log`).
Explicit strict tsgo over loader.test.ts also passed. The independent gate
approved the scoped change (`review.md`).

Final root `bun test --timeout 20000`: **18,720 pass, 40 existing skips, zero
failures**, recorded in `root-tests.log`. `typecheck-final.log` and `build-final.log`
record successful root typecheck/build. Explicit strict tsgo over loader.test.ts
also passed. The independent review approved the change (`review.md`).

`team-live/receipt.json` records 12 passing real-host Team, BTW, monitor and
notification checks using the new independent configuration.

## Real surface observations

`live/` records the initial failure on the global OpenCode2 2.0.4 binary. This
adapter still pins SDK 2.0.3; activation fails at `ctx.catalog.transform`, and
command payloads have also changed. Config separation does not fix that separate
version incompatibility. The global installation was not modified or downgraded.

A temporary exact `@opencode/cli@2.0.3` selected through `QA_OPENCODE_BIN` passed
35 production/installer checks: `live-2.0.3/receipt.json`. User and project original
OMO fixtures carry contradictory models and feature flags. Actual v2 model calls,
tool registration and disabled-feature behavior follow only user opencode2.json.
Both original files remain byte-identical. Host hashes include both new config
extensions and receipts show session counts and process cleanup. A second run at
`pinned-live/` passed the same checks; it is redundant and not additional coverage.

The extended production driver also passed 12 checks (`team-live/receipt.json`)
covering full Team, BTW, notifications, real monitor execution and mixed quotas
using the dedicated user configuration. All QA-owned processes were closed and
temporary sandbox directories removed by the drivers.

## Coverage and limits

The changed loader is the single settings-file entry for v2 consumers. Unit tests
prove both readers coexist and project/profile safety is preserved; real-host
requests prove the dedicated settings reach native registration and execution.
This separates plugin settings, not shared Team/boulder state, authentication or
host plugin lists. Incompatible v1/v2 host registrations require distinct host
configuration directories as documented.

No real personal configuration or credentials were modified or copied. All model
traffic used local fixtures. Historical failed attempts are retained as failures.
