#!/usr/bin/env bash
# OpenCode2 todowrite tool + todo-state injection QA against the real pinned
# Windows binary. Proves the tool is registered, callable, and that todo state
# appears in the context composer trace only after a todowrite call.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OUT="$EVIDENCE_DIR/out"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME_WINDOWS="${USERPROFILE:-$HOME}"
REAL_HOME="$(cygpath -u "$REAL_HOME_WINDOWS" 2>/dev/null || printf '%s' "$REAL_HOME_WINDOWS")"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

mkdir -p "$OUT"
exec > >(tee "$OUT/qa-summary.txt") 2>&1

PASS=0
FAIL=0

check() {
  if [ "$2" = "0" ]; then
    echo "PASS  $1  ($3)"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $1  ($3)"
    FAIL=$((FAIL + 1))
  fi
}

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,project}
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY

ISOMARK="$SANDBOX/isolation.marker"
touch "$ISOMARK"

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"

cat > "$SANDBOX/project/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
printf '{}\n' > "$SANDBOX/project/package.json"

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "plugin:  $PLUGIN_ENTRY"
echo ""

# ---------------------------------------------------------------------------
# Case 1: todowrite call + injection (positive direction)
# ---------------------------------------------------------------------------
echo "=== case 1: todowrite call + todo-state injection ==="
TRACE1="$SANDBOX/trace1.ndjson"
export OMO_SPIKE_TRACE="$TRACE1"

PROMPT1='Use the todowrite tool to create exactly this todo list: [{"id":"task-a","content":"Implement the feature","status":"in_progress","priority":"high"},{"id":"task-b","content":"Write tests","status":"pending","priority":"medium"}]. Then confirm the list was created.'

cd "$SANDBOX/project"
timeout -k 5 300 "$OC2" run --standalone --auto "$PROMPT1" > "$OUT/run-todo.txt" 2>&1 || true

if [ -f "$TRACE1" ]; then
  cp "$TRACE1" "$OUT/trace-todo.ndjson"
else
  echo "WARN: no trace file produced for case 1"
  touch "$OUT/trace-todo.ndjson"
fi

node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((line) => JSON.parse(line));

// 1. Tool registration includes todowrite
const reg = events.find((e) => e.event === "omo.orchestration.registered");
const hasTodo = reg && Array.isArray(reg.tools) && reg.tools.includes("todowrite");
console.log(JSON.stringify({ check: "tool-registered", pass: !!hasTodo, tools: reg?.tools }));
process.exit(hasTodo ? 0 : 1);
' "$OUT/trace-todo.ndjson" > "$OUT/trace-check-registered.txt" 2>&1
check "tool-registered" "$?" "todowrite in omo.orchestration.registered"

node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((line) => JSON.parse(line));

// 2. todowrite tool was executed (omo.todo.write trace event)
const writes = events.filter((e) => e.event === "omo.todo.write");
console.log(JSON.stringify({ check: "tool-executed", pass: writes.length > 0, count: writes.length, detail: writes[0] }));
process.exit(writes.length > 0 ? 0 : 1);
' "$OUT/trace-todo.ndjson" > "$OUT/trace-check-executed.txt" 2>&1
check "tool-executed" "$?" "omo.todo.write event present"

node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((line) => JSON.parse(line));

// 3. After todowrite, a context compose has todoParts > 0
const composed = events.filter((e) => e.event === "omo.context.composed");
const withTodo = composed.filter((e) => e.todoParts > 0);
console.log(JSON.stringify({ check: "state-injected", pass: withTodo.length > 0, composedCount: composed.length, withTodoCount: withTodo.length }));
process.exit(withTodo.length > 0 ? 0 : 1);
' "$OUT/trace-todo.ndjson" > "$OUT/trace-check-injected.txt" 2>&1
check "state-injected" "$?" "omo.context.composed with todoParts > 0"

# ---------------------------------------------------------------------------
# Case 2: no todowrite call, no injection (negative direction)
# ---------------------------------------------------------------------------
echo ""
echo "=== case 2: no todowrite call, no injection ==="
TRACE2="$SANDBOX/trace2.ndjson"
export OMO_SPIKE_TRACE="$TRACE2"

PROMPT2='What is 2+2? Answer with just the number.'

cd "$SANDBOX/project"
timeout -k 5 300 "$OC2" run --standalone --auto "$PROMPT2" > "$OUT/run-no-todo.txt" 2>&1 || true

if [ -f "$TRACE2" ]; then
  cp "$TRACE2" "$OUT/trace-no-todo.ndjson"
else
  echo "WARN: no trace file produced for case 2"
  touch "$OUT/trace-no-todo.ndjson"
fi

node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((line) => JSON.parse(line));

// No omo.todo.write events
const writes = events.filter((e) => e.event === "omo.todo.write");
console.log(JSON.stringify({ check: "no-tool-executed", pass: writes.length === 0, count: writes.length }));
process.exit(writes.length === 0 ? 0 : 1);
' "$OUT/trace-no-todo.ndjson" > "$OUT/trace-check-no-executed.txt" 2>&1
check "no-tool-executed" "$?" "no omo.todo.write without tool call"

node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((line) => JSON.parse(line));

// All composed events have todoParts === 0
const composed = events.filter((e) => e.event === "omo.context.composed");
const withTodo = composed.filter((e) => e.todoParts > 0);
console.log(JSON.stringify({ check: "no-state-injected", pass: withTodo.length === 0, composedCount: composed.length, withTodoCount: withTodo.length }));
process.exit(withTodo.length === 0 ? 0 : 1);
' "$OUT/trace-no-todo.ndjson" > "$OUT/trace-check-no-injected.txt" 2>&1
check "no-state-injected" "$?" "no todoParts in composed without todowrite"

# ---------------------------------------------------------------------------
# Isolation sweep
# ---------------------------------------------------------------------------
echo ""
echo "=== isolation sweep ==="
find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" "$REAL_HOME/.cache/opencode" \
  -newer "$ISOMARK" -type f 2>/dev/null \
  | grep -v 'opencode\.db' \
  | grep -v '\.log$' \
  | grep -v '\.lock$' \
  | grep -v '/shell/' \
  | grep -v '/snapshot/' \
  | grep -v '/storage/' \
  | grep -v 'models\.json$' \
  | grep -v '/tool-output/' \
  > "$OUT/isolation-violations.txt" || true

VIOLATIONS=$(wc -l < "$OUT/isolation-violations.txt")
check "isolation" "$([ "$VIOLATIONS" = "0" ] && echo 0 || echo 1)" "$VIOLATIONS host-store writes"

echo ""
echo "summary: PASS=$PASS FAIL=$FAIL"
exit "$FAIL"
