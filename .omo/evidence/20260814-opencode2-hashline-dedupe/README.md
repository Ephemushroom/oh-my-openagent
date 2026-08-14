# OpenCode2 Hashline Dedupe QA Evidence

Date: 2026-08-14 | Branch: `fix/opencode2-hashline-dedupe` | Base: `dev` at `b04a7b3b7`

## WHAT WAS TESTED

Two hashline implementations were live on `dev` at once. The original port (#12)
landed directory modules at `hooks/hashline-read-enhancer/` and
`tools/hashline-edit/`. A later duplicate PR (#17) landed flat files at
`hooks/hashline-read-enhancer.ts` and `tools/hashline-edit.ts` covering the same
ground.

`src/index.ts` imports `./hooks/hashline-read-enhancer`. Node resolves a `.ts`
file before a directory `index.ts`, so the FLAT files were the live code and the
directory modules were unreachable, though their tests still ran and still
passed. Roughly 580 lines were being tested but never executed.

That mattered because the two implementations are not equivalent. The flat
version reads `event.result.content` inside its trace call, which runs BEFORE
the guard clause that checks whether the tool is a completed `read`:

```ts
await ctx.tool.hook("execute.after", (event: any) => {
  trace?.("hashline.hook.fired", { ..., content: event.result.content })
  if (!isReadTool(event.tool) || event.status !== "completed") return
```

Any tool whose `result` is absent therefore crashes the hook. It also types the
event as `any`, which this repo forbids. The directory version checks the guard
first, is fully typed, and handles both the string and content-array result
shapes.

This was not found by reading the code. It surfaced while QA'ing an unrelated
change (the tool guards): a live session tried `edit`, and the hook threw
`undefined is not an object (evaluating 'event.result.content')`, so the model
had to fall back to `hashline_edit`.

The fix deletes the four flat files from #17 and keeps the directory modules.
No import changes are needed: `./hooks/hashline-read-enhancer` now resolves to
the directory.

- Regression test: `hooks/hashline-read-enhancer/register-foreign-tool.test.ts`
  pins the crash directly. It registers the real hook and fires it with a
  non-read tool whose `result` is undefined, and with a completed non-read tool
  reporting no content. Both must return without throwing. These fail against
  the flat implementation and pass against the directory one.
- Package suite: `bun test packages/omo-opencode2/src` at 95 pass, 0 fail.
- Type safety: `bun run typecheck` exit code 0.
- Real surface: `qa.sh` drove the pinned Windows `opencode2.exe` with
  `zhipuai/glm-4.7` in an isolated XDG, HOME, and USERPROFILE sandbox, running
  the exact read-then-edit round trip that first exposed the crash.

## WHAT WAS OBSERVED

- `out/qa-summary.txt`: `summary: PASS=7 FAIL=0`.
- No crash: the transcript in `out/run-edit.txt` contains no
  `undefined is not an object` string. Before this change the same round trip
  produced `Edit target.ts failed / Error: undefined is not an object
  (evaluating 'event.result.content')`.
- Tagging still works: `out/trace-edit.ndjson` carries
  `omo.hashline.tag-applied` for tool `read`.
- The tags reached the model: the transcript shows a `hashline_edit` call citing
  `"pos":"1#QQ"`. The model could only know that identifier from a tagged read,
  so this corroborates delivery independently of the trace.
- The hashline contract behaved correctly end to end. The trace shows
  `omo.hashline.edit-rejected` followed by `omo.hashline.edit-accepted`: the
  model first sent a literal `LINE#QQ` placeholder, which was correctly
  rejected, then sent the real `1#QQ`, which was accepted.
- The edit landed: `target.ts` contains `value = 3`.
- No shadowing remains: neither flat file exists.
- `out/isolation-violations.txt` is empty.

## WHY IT IS ENOUGH

The regression test pins the specific defect at the unit level and is written so
that it fails against the deleted implementation, which is what makes it a
regression test rather than a restatement of current behavior.

The live run then proves the three things that actually matter to a user in one
round trip: the hook no longer crashes on a foreign tool result, `read` output
is still tagged, and a hash-validated edit still applies. Asserting tagging on
the trace rather than the transcript matters, because the CLI prints a
`Read <file>` summary instead of the raw tool result. An earlier version of this
QA grepped the transcript for tagged lines and reported a false failure; the
assertion now targets the surface where tags are actually delivered, with the
model's own `1#QQ` citation as a second, independent witness.

## WHAT WAS OMITTED

- The ZhipuAI key was read from the v1 auth store into the child process
  environment only. It was never printed, copied, or committed.
- Behavioral equivalence between the two implementations was not exhaustively
  diffed. The directory version was kept because it is the one with the guard
  clause ordered correctly, full typing, and both result shapes handled; the
  flat version's only unique behavior was the crashing trace line.
- The known Windows `spawn-with-timeout.test.ts` failure is pre-existing on
  clean `dev` and was not run or changed.
- Cubic is not installed on `Ephemushroom/oh-my-openagent`, so no Cubic review
  was awaited.
