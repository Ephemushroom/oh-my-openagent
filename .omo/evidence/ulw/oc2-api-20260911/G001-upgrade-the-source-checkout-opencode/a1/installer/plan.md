# Installer lane

Scope: only the standalone resolver and config writer plus their co-located tests. Parent plan: opencode2-api-upgrade-plan.md, step 4. No dependency, publication, adapter or global-config changes.

1. Run the current resolver, config writer and installer tests; save PIN output.
2. Change resolver test to require the containing source directory, keeping missing-payload coverage. Capture RED, return dirname of existing index.ts, capture GREEN.
3. Add writer regressions for native string/object legacy paths, comments/options/backups, repeat calls, directory duplicates, unrelated paths, missing/malformed configs. Cover relative and file URLs according to host source.ts lines 139-144. Cover singular plugin strings and [path, options] tuples according to normalize.ts lines 185-190. Preserve unrelated entries and keys.
4. Apply minimal JSONC leaf edits, preserving existing user content. Type parser errors as ParseError[]. Validate all relevant containers before any write. Capture RED/GREEN logs.
5. Run diagnostics on all four files, with tsgo fallback. Run an isolated HOME/XDG subprocess invoking the real standalone resolver and config writer, capturing successful migration, idempotence, backup and malformed-input rejection. Do not start a host session: parent owns full live-host QA.

Call path finding: runOpenCode2Installer currently calls a separate inline resolver in install-opencode2.ts, not the assigned standalone resolver. That inline resolver returns require.resolve or a fabricated fallback. Lead must wire it to the corrected source-only resolver; caller production file is outside this lane's explicit ownership.

Host normalization: native plugins entries accept strings or package/options objects. Singular plugin accepts strings or two-item [string, record] tuples and is concatenated before native plugins. Relative paths are interpreted only for ./ and ../, relative to the config file directory; file:// URLs are decoded. Bare package strings and removal directives are not local-path matches. Match only the supplied source directory or its index.ts.

Expected impact: installer config bytes and returned source path only. No hook, tool, model, MCP, or session behavior is changed here. opencode-qa loaded and scoped to installer/config surface; full host execution remains the parent's gate.
