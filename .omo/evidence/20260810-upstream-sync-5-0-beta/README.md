# Evidence: upstream sync to v5.0.0-beta.4 (chore/upstream-sync-5.0-beta)

Date: 2026-08-10. Base: fork dev @ 28a7121e4 (PR #1). Target: upstream/dev @ ea2b38717 (v5.0.0-beta.4).

## What was merged

56 upstream commits: the omo-ai native edition (`packages/omo-native`, senpi-based
distribution, beta npm channel), `packages/memory-core` (Letta-parity memory Core
package), the memory MCP server + senpi memory components, subagent watcher guidance in
shared-skills, plus assorted fixes. No upstream opencode2 adapter exists; the agents tree
(`packages/omo-opencode/src/agents/`) is untouched except one AGENTS.md doc, so the
Phase 1 agents-core extraction plan stays valid.

## Conflicts and resolution

- `package.json`: workspaces/typecheck chain/devDeps merged as the union of both sides
  (omo-native + memory-core + omo-opencode2 all registered).
- `bun.lock`: taken from upstream, then regenerated with `bun install --ignore-scripts`
  (1194 packages).
- `packages/AGENTS.md`, `script/package-registration-audit.test.ts`, root `AGENTS.md`:
  auto-merged; the registration audit now lists memory-core (core) and omo-native +
  omo-opencode2 (adapters), and its devDep rule exempts both self-published packages
  (omo-opencode and omo-native/omo-ai).

## Gates (all on the merged tree, Windows host)

- `bun test script/package-registration-audit.test.ts opencode-coupling-audit.test.ts
  prompt-async-route-audit.test.ts`: 18/18 pass.
- `bun run typecheck`: clean across all packages including memory-core, omo-native,
  omo-opencode2.
- Spike QA re-run (`bash .omo/evidence/20260810-opencode2-spike/qa.sh`): PASS 15/15,
  transcript in `.omo/evidence/20260810-opencode2-spike/out/qa-console-resync.log` —
  the omo-opencode2 adapter is unaffected by the sync (it depends only on the pinned
  `@opencode-ai/plugin`, not on v1 adapter internals).
- Full `bun test`: classified against the known pre-existing environmental failure set
  (see `.omo/evidence/20260810-opencode2-spike/out/bun-test-classification.md`); any new
  failure class would be called out in the PR. Result recorded in the PR body.

## Why this is enough

A pure upstream merge changes no omo-opencode2 code paths; the spike QA re-run proves the
opencode2-facing behavior is intact, and the registration/typecheck audits prove the merged
workspace graph is well-formed.

## Omitted

No new secrets touched. The provider key handling matches the spike QA driver
(process env only, never persisted).
