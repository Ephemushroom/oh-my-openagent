# QA Evidence: Hashline Port to OpenCode2

## WHAT WAS TESTED
The porting of the Hashline edit system from omo's v1 adapter to the `omo-opencode2` adapter. This includes:
1. `registerHashlineReadEnhancer`: an `execute.after` tool hook that intercepts the native `read` tool's output and prepends `LINE#ID` hashes.
2. `hashline_edit`: a tool that accepts `RawHashlineEdit` inputs, validates them against the target file, and safely edits it.

The testing evaluated:
- Idempotent and array-based content rewriting in the v2 `execute.after` hook.
- Correct file manipulation using `node:fs/promises` in the v2 environment.
- FAIL-CLOSED safety: edits with stale or wrong hashes must abort without corrupting or partially writing the file.

## WHAT WAS OBSERVED
1. `bun test` passed successfully in the newly ported module `packages/omo-opencode2/src`.
2. `bun run typecheck` returned zero errors for `packages/omo-opencode2`.
3. In a fully isolated sandbox (`qa.sh`), a live session correctly consumed the tagged `read` output (`C3 PASS`).
4. A live `hashline_edit` tool call correctly manipulated the file on disk (`C4 PASS`).
5. A subsequent direct `hashline_edit` call using an intentionally bad hash (`2#ZZ`) failed with `HashlineMismatchError`, leaving the file exactly byte-identical to its prior state (`C5 PASS`).
6. Trace events correctly triggered (`hashline.read-enhancer.applied`, `hashline.edit.success`, `hashline.edit.error`).

## WHY IT IS ENOUGH
The live QA proves the core value prop of Hashline: the ability to safely fail closed and prevent hallucination drift or stale-read data loss in a real environment running `opencode2`. We verified the raw file bytes directly via `sha256sum`, so we aren't trusting the LLM's prose.

## WHAT WAS OMITTED
- API Keys (`ZHIPU_API_KEY`) and personal paths were generated randomly per sandbox or redacted.
- Formatting hook (`runFormattersForFile`) was omitted from the v2 tool execution logic as the formatter client wasn't accessible yet, but this doesn't impact Hashline core capability.
- Overwriting the native OpenCode2 `edit` tool was explicitly omitted per instructions (Risk R7). The native tool remains untouched.
