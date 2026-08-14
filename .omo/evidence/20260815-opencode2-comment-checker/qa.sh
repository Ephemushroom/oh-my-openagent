#!/usr/bin/env bash
# OpenCode2 comment-checker QA against the real pinned Windows binary.
# Asserts plugin traces, not summarized CLI tool output.
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
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj}
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

FIX="$SANDBOX/proj"
ISOMARK="$SANDBOX/isolation.marker"
touch "$ISOMARK"

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
cat > "$FIX/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
printf '{}\n' > "$FIX/package.json"

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

run_case() {
  local name="$1"
  local prompt="$2"
  export OMO_SPIKE_TRACE="$SANDBOX/trace-$name.ndjson"
  : > "$OMO_SPIKE_TRACE"
  (cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$prompt") > "$OUT/run-$name.txt" 2>&1
  local status=$?
  cp "$OMO_SPIKE_TRACE" "$OUT/trace-$name.ndjson"
  return "$status"
}

trace_match() {
  local name="$1"
  local event="$2"
  local outcome="${3:-}"
  local min_count="${4:-1}"
  node - "$OUT/trace-$name.ndjson" "$event" "$outcome" "$min_count" > "$OUT/trace-check-$name-${event//./_}-${outcome:-any}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, eventName, outcome, minCount] = process.argv.slice(2)
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matching = events.filter((event) =>
  event.event === eventName && (outcome.length === 0 || event.outcome === outcome))
const ok = matching.length >= Number(minCount)
console.log(JSON.stringify({ eventName, outcome: outcome || null, minCount: Number(minCount), observed: matching.length, ok, samples: matching.slice(0, 3) }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

trace_absent() {
  local name="$1"
  local event="$2"
  node - "$OUT/trace-$name.ndjson" "$event" > "$OUT/trace-check-$name-absent-${event//./_}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, eventName] = process.argv.slice(2)
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matching = events.filter((event) => event.event === eventName)
console.log(JSON.stringify({ eventName, observed: matching.length, ok: matching.length === 0 }, null, 2))
process.exit(matching.length === 0 ? 0 : 1)
NODE
}

echo "## clean write fires the hook without false-positive detection"
run_case "clean" "Use the write tool exactly once to create clean.ts with exactly this content and no comments: export function add(left: number, right: number) { return left + right }"
check "clean.run" "$?" "real session completed"
trace_match "clean" "omo.comment-checker.registered"
check "clean.registered" "$?" "comment-checker registered on the live plugin"
trace_match "clean" "omo.comment-checker.checked" "clean"
check "clean.checked" "$?" "completed write traversed the post-tool checker path"
trace_absent "clean" "omo.comment-checker.detected"
check "clean.not-detected" "$?" "clean code produced no detection event"

echo "## one live slop-write attempt"
run_case "slop" "Use the write tool exactly once to create slop.ts with exactly these two lines: // This function adds two numbers, then export function add(left: number, right: number) { return left + right }. Do not remove or justify the comment before writing."
check "slop.run" "$?" "single real-session attempt completed"

if trace_match "slop" "omo.comment-checker.detected"; then
  printf 'LIVE_DETECTION_PROVED\n' > "$OUT/slop-live-outcome.txt"
  check "slop.detected" 0 "written slop produced the distinct detection trace"
elif [ -f "$FIX/slop.ts" ] && grep -qF '// This function adds two numbers' "$FIX/slop.ts"; then
  printf 'LIVE_SLOP_WRITTEN_BUT_NOT_DETECTED\n' > "$OUT/slop-live-outcome.txt"
  check "slop.detected" 1 "slop remained on disk without a detection trace"
else
  printf 'MODEL_REFUSED_OR_SELF_CORRECTED_UNIT_DETECTION_ONLY\n' > "$OUT/slop-live-outcome.txt"
  check "slop.model-refusal" 0 "model did not leave the requested slop; detection branch remains unit-proven"
fi

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
    ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" ! -path "*/tool-output/*" \
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
