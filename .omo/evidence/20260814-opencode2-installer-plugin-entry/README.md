# QA Evidence: opencode2 installer writes the plugin entry

Date: 2026-08-14 | Branch: `feat/opencode2-installer-plugin-entry` | Base: `dev` @ a83b0ecc6

## Scope

`runOpenCode2Installer()` previously wrote only `mcp.servers`. The `plugins` array
was explicitly preserved but never populated, so a completed
`install --platform=opencode2` produced a config that did NOT load the v2 adapter.
The user had to hand-edit `opencode.json` to get any OMO behavior. This change
makes one install produce a config that actually loads the plugin.

## What was tested

### Unit gate (hermetic, `bun test`)

- `update-opencode2-plugin-config.test.ts` — **5 pass / 0 fail**: fresh config
  with no `plugins` key; append beside an existing unrelated entry; idempotency;
  malformed JSONC fails closed; non-array `plugins` fails closed.
- `resolve-opencode2-plugin-entry.test.ts` — **2 pass / 0 fail**: walk-up finds
  the entry from a nested directory; a tree without the adapter reports missing
  rather than fabricating a path.
- Full CLI suite `bun test packages/omo-opencode/src/cli/` — **706 pass / 1 fail**.
- `bun run typecheck` — exit code 0.

RED->GREEN captured: the malformed-JSONC case initially FAILED (4 pass / 1 fail).
`jsonc-parser.parse()` is error-tolerant and recovered `{ "plugins": [ }` into a
partial object, so the writer would have silently rewritten a corrupt file. Fixed
by collecting `ParseError[]` and throwing before any write, rather than relaxing
the test.

### Real-surface QA (isolated sandbox, real opencode2 binary)

`bash .omo/evidence/20260814-opencode2-installer-plugin-entry/qa.sh` — **PASS=10 FAIL=0**.
Binary `opencode2 v0.0.0-next-17055` (windows-x64), model `zhipuai/glm-4.7`,
isolated `XDG_*` / `HOME` / `USERPROFILE`, installer retargeted through
`OPENCODE_CONFIG_DIR`. Artifacts in `out/`.

The driver runs the REAL `runOpenCode2Installer()` entry point, not a stub.

1. `install.exit` — the installer completed against the sandbox config.
2. `cfg.comment` — a `//` comment in the seed config survived the write.
3. `cfg.user-plugin` — a pre-existing `"some-user-plugin"` entry survived.
4. `cfg.plugin-entry` — the omo-opencode2 entry was written.
5. `cfg.mcp` — `mcp.servers` was still written in the same run.
6. `cfg.idempotent` — a second install left exactly one entry.
7. `install.idempotent-report` — the second run reported `pluginAdded: false`.
8. `live.plugin-loaded` — a real opencode2 session driven with the
   installer-written config emitted `omo.registration.complete`.
9. `isolation.real-config` — real `~/.config/opencode/opencode.json` sha256
   identical before and after.
10. `isolation.clean` — no new files in the real opencode stores.

## What was observed

- The written entry is a native Windows absolute path
  (`D:\...\packages\omo-opencode2\src\index.ts`). This was the main open question,
  and the live run settles it: opencode2 loads that form. The run transcript
  (`out/run-live.txt`) shows `> sisyphus · glm-4.7`. `sisyphus` is an OMO agent,
  not an opencode2 builtin, so agent registration from the installer-written
  config is proven by observed behavior rather than by a log line alone.
- `mcp.servers` landed `codegraph`, `context7`, `grep_app`. `lsp` was skipped
  because the daemon cli did not resolve on this machine. That is the
  pre-existing best-effort degradation in `buildOpenCode2Entries` and is not
  affected by this change.
- All inputs are resolved BEFORE the first write, so a missing v2 source cannot
  leave the config half-updated with MCP entries but no plugin entry.

## Why it is enough

The unit tests pin the writer's contract (append, preserve, idempotent, fail
closed on both malformed JSONC and a non-array `plugins`). The live run proves
the end-to-end claim that actually matters: a config produced by the installer
loads the plugin in a real opencode2 session. The before/after sha256 pair plus
the newer-than-marker sweep prove the user's real config was never a write target
even though the driver exercised the real top-level installer entry.

## What was omitted

- No secrets. The provider key is read from the v1 auth store into the child
  env only, never printed or persisted. No env dumps in `out/`.
- `lsp` MCP registration was not exercised (daemon cli absent on this machine);
  it is unchanged by this PR.
- Distribution is NOT solved here. `packages/omo-opencode2` is `private`,
  version `0.0.0`, and absent from the root `files` array, so it exists only in a
  source checkout. The installer therefore fails closed with an actionable
  message when the adapter source is missing, which is the correct behavior for
  an unpublished package (design doc risk R9). Shipping the adapter to npm
  consumers needs its own change.
- The pre-existing `doctor/spawn-with-timeout.test.ts` failure is unrelated to
  this change. It reproduces on a clean checkout of base `a83b0ecc6` with none of
  these edits applied (verified directly), and is a Windows exit-code quirk in a
  doctor helper.
- The same error-tolerant `jsonc-parser.parse()` weakness still exists in the
  sibling `update-opencode2-mcp-config.ts`. It is out of scope here and left
  untouched deliberately; it deserves its own fix.
