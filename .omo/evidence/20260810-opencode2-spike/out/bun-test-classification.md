# bun test classification (full suite on this branch, 2026-08-10)

`bun test` on the branch: 13362 pass / 56 skip / 42 fail (13460 tests, 388s).

Every failure was classified against a pristine `origin/dev` worktree
(`D:\Programme\AI\oh-my-openagent-wt\base-dev`, same machine, same environment):

- 41 of 42 reproduce identically on the base worktree: Windows symlink handling
  (`CLAUDE.md`), missing `.agents` docker-qa reference, unbuilt Codex/Senpi dist
  payloads, DMCA submodule pins, Codex installer Windows env, codegraph
  provisioning downloads, Senpi QA self-tests, telemetry/PostHog env flags,
  spawn-with-timeout. None are touched by this PR.
- `packages/omo-opencode/src/tools/task/task-list.test.ts` flakes under full-suite
  load (a different case fails per run); passes in isolation (8/8) on this branch;
  the file is untouched by this PR.
- The two meta-audit failures this PR initially introduced (opencode-coupling-audit,
  prompt-async-route-audit) were fixed in commit "test: register omo-opencode2 in the
  repo meta-audits" and re-verified green (12/12).

`bun run typecheck`: clean, includes packages/omo-opencode2.
`bun run build`: green; on this Windows host the vendored npm builds need Git's
usr/bin on PATH (`rm` shim), a pre-existing repo/CI convention.
