# QA Evidence: OpenCode2 shared skills and builtin commands

Date: 2026-08-14 | Branch: `feat/opencode2-skills-commands`

## WHAT WAS TESTED

- Failing-first given/when/then unit tests for native `skill.transform` directory registration, `command.transform` upserts, and model-facing skill/command catalog injection. RED and GREEN artifacts are in `out/tests-red.txt`, `out/tests-green.txt`, `out/command-visibility-red.txt`, `out/command-visibility-green.txt`, `out/skill-visibility-red.txt`, and `out/catalog-visibility-green.txt`.
- `bun test packages/omo-opencode2/src`: 79 pass, 0 fail, 263 assertions. Artifact: `out/package-tests.txt`.
- `bun run typecheck`: exit 0 across the root, scripts, and all package typechecks. Artifact: `out/typecheck.txt`.
- A real `opencode2 v0.0.0-next-17055` standalone session with `zhipuai/glm-4.7`, using an isolated HOME and XDG sandbox.
- Live model output listing registered skills and commands.
- Live activation of the registered `programming` skill, with the model returning a path present only in the loaded SKILL.md body.
- A newer-than-marker sweep of the real OpenCode stores.

## WHAT WAS OBSERVED

- `qa.sh` finished with `summary: PASS=8 FAIL=0`; console artifact: `out/qa-console.log`.
- Trace events `omo.skills.registered` and `omo.commands.registered` fired in the real binary, followed by `skill.updated` and `command.updated`. The live context observed 42 materialized skills. Artifact: `out/trace.ndjson`.
- The live catalog response included `programming`, `git-master`, and all seven OMO commands: `goal`, `refactor`, `start-work`, `stop-continuation`, `handoff`, `remove-ai-slops`, and `hyperplan`. Artifact: `out/run-catalog.jsonl`.
- The model called the native `skill` tool with `id: programming`; its completed tool result contained the full shared SKILL.md body, including `references/typescript/README.md`. Artifacts: `out/run-skill-load.jsonl` and `out/export-skill.json`.
- `out/isolation-violations.txt` is empty. No newer files appeared in the real OpenCode data or config stores.

## WHY IT IS ENOUGH

The unit tests pin the exact installed v2 draft contracts and idempotent model-facing catalog format. The real binary proof goes beyond registration traces: the live model enumerates both registered catalogs and invokes the native skill tool, whose persisted completed result contains a body-only reference path. The export and trace preserve both model-facing and mechanism-level evidence, while the isolation sweep proves the test did not write into the user's real OpenCode stores.

## WHAT WAS OMITTED

- The provider key is read from the v1 auth store into the child process environment only. It is never printed, copied, or committed.
- Raw environment dumps and provider request logs are not captured because they may contain credentials or private metadata.
- A provider 429 may occur after the completed `skill` tool result. QA treats the persisted completed tool delivery as the success boundary because the required body already reached the model-facing session before any later provider retry.
- Command execution semantics beyond registration and model visibility remain owned by OpenCode2's native slash-command expansion.
