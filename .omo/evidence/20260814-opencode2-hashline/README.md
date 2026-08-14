# QA Evidence: omo-opencode2 hashline (read enhancer + hashline_edit)

Date: 2026-08-14 | Branch: `feat/opencode2-hashline` | Base: `dev` @ a83b0ecc6

Port of the Hashline hash-anchored edit system to the OpenCode2 adapter
(`packages/omo-opencode2/`): the read enhancer that tags every builtin `read`
result with `LINE#ID` content hashes, and the hash-validated `hashline_edit`
tool that rejects an edit whose anchor hash no longer matches the file. Both
built on `@oh-my-opencode/hashline-core`; no hashing is reimplemented.

## WHAT WAS TESTED

### Unit gate (hermetic, `bun test`, given/when/then)

`packages/omo-opencode2`: **66 pass / 0 fail**, package `tsgo --noEmit` clean,
repo-wide `bun run typecheck` exit 0.

New co-located tests (13):
- `hooks/hashline-read-enhancer/tag-read-output.test.ts` (5): content-block
  tagging; the v2 header-led read shape (pinned from the real QA export);
  plain numbered output; idempotent repeat tagging; non-text payload untouched.
- `hooks/hashline-read-enhancer/register.test.ts` (4): string content tagged;
  the ARRAY-of-content-parts shape tagged with non-text parts untouched (R12);
  idempotency for both string and array shapes across repeated calls.
- `tools/hashline-edit/execute-hashline-edit.test.ts` (4): valid hash applies;
  stale hash rejected + file byte-identical; hash of content changed after read
  rejected + file unchanged; missing file rejected fail-closed with no write.

RED->GREEN captured: `out/unit-red.txt` (0 pass / 3 fail, module-not-found for
`./tag-read-output`, `./register`, `./execute-hashline-edit`) then
`out/unit-green.txt` (13 pass).

### Real-surface QA (isolated sandbox, real opencode2 binary)

`bash .omo/evidence/20260814-opencode2-hashline/qa.sh` -> **PASS=5 FAIL=0**.
Model `zhipuai/glm-4.7`, binary `opencode2 v0.0.0-next-17055` (windows-x64),
isolated XDG/HOME/USERPROFILE sandbox. Artifacts in `out/`: `version.txt`,
`run-c3.txt`, `export-c3.json`, `edit-driver.txt`, `trace.ndjson`,
`isolation-violations.txt`.

## WHAT WAS OBSERVED

- **C1 RED->GREEN**: `out/unit-red.txt` -> `out/unit-green.txt`; full package
  suite 66 pass.
- **C2**: `bun run typecheck` exit 0 (no `as any` / suppressions).
- **C3 (live)**: trace `omo.hashline.tag-applied` fired on the real `read` call,
  and `omo.hashline.tool-registered` proved `hashline_edit` registered on the
  live binary. The model-facing `export-c3.json` read tool-result carries
  `1#JY|`, `2#BM|`, `3#RZ|` tags (the enhancer mutated `execute.after` result
  and the core read it back), and the model echoed a `LINE#ID` line.
- **C4 (edit accept)**: `edit-driver.ts` drove the REGISTERED `hashline_edit`
  tool's `execute` with a valid `1#<hash>` anchor; the fixture file on disk
  changed to `const x = 42` with neighboring lines intact.
- **C5 (stale-hash reject)**: driving `execute` with a stale `1#ZZ` anchor
  returned `Error: Hash mismatch ... Re-read ...` and the fixture file was
  proven byte-identical by sha256 compare (`before=dfce3e6c36ae`,
  `after=dfce3e6c36ae`). This is the criterion the whole feature exists for.
- **Isolation**: `isolation.clean` - no new files in the real
  `~/.local/share/opencode` or `~/.config/opencode` after a marker touch.

Trace event names added: `omo.hashline.tag-applied`,
`omo.hashline.tag-error`, `omo.hashline.tool-registered`,
`omo.hashline.edit-accepted`, `omo.hashline.edit-rejected`,
`omo.hashline.registered`.

## WHY IT IS ENOUGH

The read enhancer and edit tool are pinned by unit tests over both content
shapes (R12 array + string), by idempotency tests (the `execute.after` hook
fires for every tool call and must not double tag), and by fail-closed edit
tests (stale, changed, missing). The live opencode2 session proves the enhancer
runs on a real model's real read and the tagged content reaches the model, plus
tool registration on the real binary. C4/C5 are proven against fixture file
BYTES, not model prose; the stale-hash rejection leaving the file byte-identical
is proven by sha256 equality, which is the pre-write rejection guarantee that
justifies the feature.

## WHAT WAS OMITTED

- **Model-driven C4/C5**: model tool-calling is probabilistic, so C4/C5 drive
  the REGISTERED tool's `execute` path in-process (via `registerHashlineEditTool`
  with a capturing context) rather than coaxing the model to call it on demand.
  The mechanism is still proven end-to-end: the same registration function the
  plugin uses is exercised, and C3 proves the tool is registered on the live
  binary. Only the model's decision to invoke it is bypassed.
- **Builtin `edit` reconciliation (R7)**: `hashline_edit` is registered under a
  distinct name and does NOT shadow, replace, or delete the v2 builtin `edit`.
  Hiding builtin `edit` for OMO agents via the context hook is deliberately
  deferred to a later PR.
- **Secrets**: the zhipuai key is read from the v1 auth store into the child env
  only; never persisted or printed. No env dumps or auth contents in artifacts.
- Out of scope for this PR: the other guard hooks, goal, ulw-loop, and
  skills/commands registration.
