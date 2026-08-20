#!/usr/bin/env bash
# QA for the opencode2 session history tools.
#
# Proves the four tools read the harness's own SQLite store by seeding real
# sessions in an isolated sandbox and then asking the model to call each tool,
# asserting on OMO_SPIKE_TRACE NDJSON rather than CLI prose.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/out"; mkdir -p "$OUT"

BIN="${OPENCODE2_BIN:-$HOME/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "FATAL: no opencode2 binary at $BIN"; exit 1; }
KEY="$(node -e 'try{const a=require(process.env.HOME+"/.local/share/opencode/auth.json");process.stdout.write(a.zhipuai?.key||"")}catch{}')"
[ -n "$KEY" ] || { echo "FATAL: no zhipuai key"; exit 1; }

HOST_DB="$(cygpath -u "$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')" 2>/dev/null || echo "$HOME")/.local/share/opencode/opencode.db"
host_stat() { [ -f "$HOST_DB" ] && stat -c %s "$HOST_DB" 2>/dev/null || echo "absent"; }
HOST_BEFORE="$(host_stat)"

S="$(mktemp -d)"
export HOME="$S/home" USERPROFILE="$S/home"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
export OPENCODE_TEST_HOME="$S/home" OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 ZHIPU_API_KEY="$KEY"
PROJ="$S/home/project"; mkdir -p "$PROJ" "$XDG_CONFIG_HOME/opencode"
PLUGIN="$(cygpath -m "$(cd "$REPO/packages/omo-opencode2" && pwd)")/src/index.ts"
printf '{ "plugins": ["%s"] }\n' "$PLUGIN" > "$PROJ/opencode.jsonc"

export OMO_SPIKE_TRACE="$S/trace.ndjson"; : > "$OMO_SPIKE_TRACE"
cd "$PROJ" || exit 1
run() { timeout 240 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 "$1" >> "$OUT/run.txt" 2>&1; }

# Seed distinguishable history, then ask for each tool by name.
run 'Reply with exactly: ORANGE_MARKER_ALPHA' 
run 'Reply with exactly: PURPLE_MARKER_BETA'
run 'Call the session_list tool with no arguments. Then reply DONE.'
run 'Call the session_search tool with query "ORANGE_MARKER_ALPHA". Then reply DONE.'
run 'Call session_list, take the first session id from its output, then call session_info with that session_id, then call session_read with that same session_id and limit 5. Then reply DONE.'

HOST_AFTER="$(host_stat)"
SANDBOX_DB="$XDG_DATA_HOME/opencode/opencode.db"

PASS=0; FAIL=0
check() { if [ "$2" = "1" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
count() { local n; n="$(grep -c "$2" "$1" 2>/dev/null)"; n="${n:-0}"; printf '%s' "$(printf '%s' "$n" | head -n 1)"; }

TOTAL="$(wc -l < "$OMO_SPIKE_TRACE" 2>/dev/null | tr -d ' ')"
[ "${TOTAL:-0}" -gt 0 ] && v=1 || v=0
check "plugin-loaded" "$v" "trace non-empty (lines=$TOTAL)"

REG="$(count "$OMO_SPIKE_TRACE" 'omo.session-tools.registered')"
[ "$REG" -ge 1 ] && v=1 || v=0
check "tools-registered" "$v" "omo.session-tools.registered=$REG"

# The registration trace must name all four tools.
NAMED=1
for t in session_list session_read session_search session_info; do
  grep -q "\"$t\"" "$OMO_SPIKE_TRACE" || NAMED=0
done
check "all-four-named" "$NAMED" "session_list/read/search/info present in trace"

# The sandbox store must exist and hold the sessions we just created.
[ -f "$SANDBOX_DB" ] && v=1 || v=0
check "sandbox-store-exists" "$v" "$SANDBOX_DB"

SESSIONS="$(bun "$HERE/query.ts" "$SANDBOX_DB" sessions 2>/dev/null || echo 0)"
[ "${SESSIONS:-0}" -ge 3 ] && v=1 || v=0
check "sessions-seeded" "$v" "session_v2 rows=$SESSIONS"

MARKERS="$(bun "$HERE/query.ts" "$SANDBOX_DB" marker ORANGE_MARKER_ALPHA 2>/dev/null || echo 0)"
[ "${MARKERS:-0}" -ge 1 ] && v=1 || v=0
check "marker-in-store" "$v" "ORANGE_MARKER_ALPHA rows=$MARKERS"

# The v2 CLI does not surface tool results, so run.txt cannot prove execution.
# Assert on the execution trace instead: it carries the row counts each tool
# actually read out of the store.
LIST_RUNS="$(count "$OMO_SPIKE_TRACE" '"tool":"session_list"')"
[ "$LIST_RUNS" -ge 1 ] && v=1 || v=0
check "session_list-executed" "$v" "executed trace count=$LIST_RUNS"

# A nonzero session count proves it read real rows, not an empty/missing store.
grep '"tool":"session_list"' "$OMO_SPIKE_TRACE" | grep -qv '"sessions":0' && v=1 || v=0
check "session_list-returned-rows" "$v" "at least one run reported sessions>0"

SEARCH_RUNS="$(count "$OMO_SPIKE_TRACE" '"tool":"session_search"')"
[ "$SEARCH_RUNS" -ge 1 ] && v=1 || v=0
check "session_search-executed" "$v" "executed trace count=$SEARCH_RUNS"

grep '"tool":"session_search"' "$OMO_SPIKE_TRACE" | grep -q 'ORANGE_MARKER_ALPHA' && v=1 || v=0
check "session_search-ran-seeded-query" "$v" "the seeded marker was the query"

grep '"tool":"session_search"' "$OMO_SPIKE_TRACE" | grep -qv '"matches":0' && v=1 || v=0
check "session_search-found-matches" "$v" "at least one run reported matches>0"

INFO_RUNS="$(count "$OMO_SPIKE_TRACE" '"tool":"session_info"')"
[ "$INFO_RUNS" -ge 1 ] && v=1 || v=0
check "session_info-executed" "$v" "executed trace count=$INFO_RUNS"

READ_RUNS="$(count "$OMO_SPIKE_TRACE" '"tool":"session_read"')"
[ "$READ_RUNS" -ge 1 ] && v=1 || v=0
check "session_read-executed" "$v" "executed trace count=$READ_RUNS"

grep '"tool":"session_read"' "$OMO_SPIKE_TRACE" | grep -qv '"totalMessages":0' && v=1 || v=0
check "session_read-returned-messages" "$v" "at least one run reported totalMessages>0"

[ "$HOST_BEFORE" = "$HOST_AFTER" ] && v=1 || v=0
check "host-store-untouched" "$v" "host opencode.db $HOST_BEFORE -> $HOST_AFTER"

cp "$SANDBOX_DB" "$OUT/sandbox-opencode.db" 2>/dev/null || true
tail -n 40 "$OMO_SPIKE_TRACE" > "$OUT/trace-tail.ndjson" 2>/dev/null || true
grep 'omo.session-tools.registered' "$OMO_SPIKE_TRACE" > "$OUT/registration.ndjson" 2>/dev/null || true
grep 'omo.session-tools.executed' "$OMO_SPIKE_TRACE" > "$OUT/executions.ndjson" 2>/dev/null || true

echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
