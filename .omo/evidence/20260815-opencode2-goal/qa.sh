#!/usr/bin/env bash
# OpenCode2 persistent-goal QA against the real pinned Windows binary.
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
mkdir -p "$SANDBOX"/{data,config,cache,state,home,disabled,enabled,autostart,lifecycle}
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

write_project() {
  local project="$1"
  local goal_enabled="$2"
  local goal_auto_start="${3:-false}"
  mkdir -p "$project/.omo"
  cat > "$project/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
  if [ "$goal_enabled" = "unset" ]; then
    cat > "$project/.omo/omo.jsonc" <<'EOF'
{
  "[opencode2]": {}
}
EOF
  else
    cat > "$project/.omo/omo.jsonc" <<EOF
{
  "[opencode2]": {
    "goal": {
      "enabled": $goal_enabled,
      "auto_start": $goal_auto_start
    }
  }
}
EOF
  fi
  printf '{}\n' > "$project/package.json"
}

write_project "$SANDBOX/disabled" unset
write_project "$SANDBOX/enabled" true false
write_project "$SANDBOX/autostart" true true
write_project "$SANDBOX/lifecycle" true false

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

run_case() {
  local name="$1"
  local project="$2"
  local prompt="$3"
  export OMO_SPIKE_TRACE="$SANDBOX/trace-$name.ndjson"
  : > "$OMO_SPIKE_TRACE"
  (cd "$project" && timeout -k 5 300 "$OC2" run --standalone --auto "$prompt") > "$OUT/run-$name.txt" 2>&1
  local status=$?
  cp "$OMO_SPIKE_TRACE" "$OUT/trace-$name.ndjson"
  return "$status"
}

trace_event_count() {
  local name="$1"
  local event="$2"
  local minimum="$3"
  node - "$OUT/trace-$name.ndjson" "$event" "$minimum" > "$OUT/trace-check-$name-${event//./_}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event, minimum] = process.argv.slice(2)
const records = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matches = records.filter((record) => record.event === event)
const ok = matches.length >= Number(minimum)
console.log(JSON.stringify({ event, minimum: Number(minimum), observed: matches.length, ok, samples: matches.slice(0, 3) }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

trace_event_absent() {
  local name="$1"
  local event="$2"
  node - "$OUT/trace-$name.ndjson" "$event" > "$OUT/trace-check-$name-absent-${event//./_}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event] = process.argv.slice(2)
const records = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matches = records.filter((record) => record.event === event)
console.log(JSON.stringify({ event, observed: matches.length, ok: matches.length === 0 }, null, 2))
process.exit(matches.length === 0 ? 0 : 1)
NODE
}

check_persisted_goal() {
  local project="$1"
  local expected_objective="$2"
  local expected_status="$3"
  local output="${4:-$OUT/persisted-goal-check.txt}"
  node - "$project/.omo/goal" "$expected_objective" "$expected_status" > "$output" 2>&1 <<'NODE'
const fs = require("fs")
const path = require("path")
const [directory, expectedObjective, expectedStatus] = process.argv.slice(2)
const files = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => name.endsWith(".json"))
  : []
const goals = files.map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).goal)
const matches = goals.filter((goal) => goal.objective === expectedObjective && goal.status === expectedStatus)
const ok = files.length > 0 && matches.length > 0
console.log(JSON.stringify({ files, expectedObjective, expectedStatus, matches: matches.length, ok }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

check_persisted_goal_contains() {
  local project="$1"
  local expected_fragment="$2"
  local expected_status="$3"
  local output="$4"
  node - "$project/.omo/goal" "$expected_fragment" "$expected_status" > "$output" 2>&1 <<'NODE'
const fs = require("fs")
const path = require("path")
const [directory, expectedFragment, expectedStatus] = process.argv.slice(2)
const files = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => name.endsWith(".json"))
  : []
const goals = files.map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).goal)
const matches = goals.filter((goal) => goal.objective.includes(expectedFragment) && goal.status === expectedStatus)
const ok = files.length > 0 && matches.length > 0
console.log(JSON.stringify({ files, expectedFragment, expectedStatus, matches: matches.length, ok }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

echo "## goal disabled by default-facing config"
run_case "disabled" "$SANDBOX/disabled" "Reply with the single word ok."
check "disabled.run" "$?" "real session completed"
trace_event_count "disabled" "omo.goal.disabled" 1
check "disabled.trace" "$?" "goal feature reported disabled"
trace_event_absent "disabled" "omo.goal.registered"
check "disabled.no-registration" "$?" "no goal tools or lifecycle pump registered"

echo "## enabled goal tools persist and complete a session goal"
run_case "enabled" "$SANDBOX/enabled" "Use create_goal exactly once with objective GOAL_QA_TOOL_MARKER. Then use get_goal exactly once. Then use update_goal exactly once with status complete. After all three tools succeed, reply with the single word done."
check "enabled.run" "$?" "real session completed"
trace_event_count "enabled" "omo.goal.registered" 1
check "enabled.registered" "$?" "three goal tools registered in the live plugin"
trace_event_absent "enabled" "omo.goal.auto-start-registered"
check "enabled.no-auto-start" "$?" "auto-start context hook stayed disabled by default"
trace_event_count "enabled" "omo.goal.created" 1
check "enabled.created" "$?" "create_goal executed in the live session"
trace_event_count "enabled" "omo.goal.completed" 1
check "enabled.completed" "$?" "update_goal completed the persisted goal"
check_persisted_goal "$SANDBOX/enabled" "GOAL_QA_TOOL_MARKER" "complete"
check "enabled.persisted" "$?" "versioned goal JSON retained the objective and completed status"

echo "## configured auto-start creates the first main-session goal"
AUTO_START_OBJECTIVE="Call update_goal exactly once with status complete, then reply with the single word done. Marker: GOAL_QA_AUTO_START_MARKER."
run_case "autostart" "$SANDBOX/autostart" "$AUTO_START_OBJECTIVE"
check "autostart.run" "$?" "real main session completed"
trace_event_count "autostart" "omo.goal.auto-start-registered" 1
check "autostart.registered" "$?" "configured auto-start context hook registered"
trace_event_count "autostart" "omo.goal.auto-started" 1
check "autostart.created" "$?" "first real main-session message created the goal"
check_persisted_goal_contains "$SANDBOX/autostart" "GOAL_QA_AUTO_START_MARKER" "complete" "$OUT/persisted-goal-auto-start-check.txt"
check "autostart.persisted" "$?" "auto-started objective persisted and completed"

echo "## active goal resumes from a real idle edge"
run_case "lifecycle" "$SANDBOX/lifecycle" 'Immediately call create_goal exactly once with this exact input: {"objective":"GOAL_QA_LIFECYCLE_MARKER"}. After the tool succeeds, reply with the single word created and do not call update_goal.'
check "lifecycle.run" "$?" "real session completed"
trace_event_count "lifecycle" "omo.goal.created" 1
check "lifecycle.created" "$?" "an active goal existed before the idle edge"
trace_event_count "lifecycle" "omo.goal.continuation-injected" 1
check "lifecycle.continued" "$?" "the lifecycle pump injected a duplicate-safe continuation"

echo "## host-store isolation"
REAL_STORES=()
for path in \
  "$REAL_HOME/.local/share/opencode" \
  "$REAL_HOME/.config/opencode" \
  "$REAL_HOME/.cache/opencode" \
  "$REAL_HOME/.local/state/opencode"
do
  [ -d "$path" ] && REAL_STORES+=("$path")
done

if [ "${#REAL_STORES[@]}" -eq 0 ]; then
  : > "$OUT/isolation-violations.txt"
else
  find "${REAL_STORES[@]}" -newer "$ISOMARK" -type f \
    ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
    ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" ! -name "models.json" \
    > "$OUT/isolation-violations.txt" 2>/dev/null
fi

if [ -s "$OUT/isolation-violations.txt" ]; then
  check "isolation.clean" 1 "real OpenCode stores contain newer files"
else
  check "isolation.clean" 0 "newer-than-marker sweep found no host-store writes"
fi

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
