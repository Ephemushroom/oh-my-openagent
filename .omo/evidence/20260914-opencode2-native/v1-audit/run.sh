#!/usr/bin/env bash
set -euo pipefail
: "${QA_V1_BIN_DIR:?Set QA_V1_BIN_DIR to the temporary pinned v1 installation}"
evidence=".omo/evidence/20260914-opencode2-native/v1-audit"
db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
before="$(sqlite3 -readonly "$db" 'SELECT count(*) FROM session;')"
PATH="$QA_V1_BIN_DIR:$PATH" bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test > "$evidence/smoke.log" 2>&1
after="$(sqlite3 -readonly "$db" 'SELECT count(*) FROM session;')"
printf 'real session count before=%s after=%s\n' "$before" "$after" > "$evidence/isolation.txt"
test "$before" = "$after"
