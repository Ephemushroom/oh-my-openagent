# Deferred registration remediation

Work in the lead-owned oc2-api worktree. No commits, host sessions, broad suites,
installer changes, command changes, docs changes, or lockfile changes.

## Evidence and cause

`State.transform` stores callbacks; `State.reload` only invalidates within the
setup batch. `State.get`, reached through `ctx.agent.list`, materializes them.
`registerConfiguredAgents` currently returns empty sets and an undefined prompt;
`index.ts` then snapshots them and recomputes dispatch models without overrides,
using the agent requirement table for category names.

## Edits and verification

1. Narrow context inputs in register-configured.ts and register-{primaries,
   subagents,categories}.ts to consumed SDK capabilities for assertion-free tests.
2. Extend register-configured.test.ts with a deferred transform fixture backed by
   SDK AgentEditor and Agent.Info.default. list flushes callbacks. Cover populated
   catalogs, input-derived Sisyphus base prompt and configured models. Capture red.
3. Materialize within registerConfiguredAgents before returning the prompt and
   sets. Return dispatch models derived from the materialized agent records.
   Capture green with the new regression.
4. Remove obsolete reload in index.ts and consume the returned models for direct
   and category dispatch, leaving shared gates and feature flags unchanged.
5. Run existing registration tests, per-file LSP diagnostics, package tsgo, and
   test-inclusive targeted tsgo where feasible. Record logs and scope limitations.

The lead owns actual direct/category task execution, Sisyphus rebake QA, broad
gates, and delta review. The pre-existing large index.ts is only reduced locally;
no structural rewrite is part of this remediation.
