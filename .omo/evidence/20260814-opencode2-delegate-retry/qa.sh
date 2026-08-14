#!/usr/bin/env bash
# OpenCode2 delegated-result guidance QA against the pinned Windows binary.
# The live model proves the normal task path is registered and untouched.
# Deterministic empty/error detection is covered by the captured unit gate.
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
trap 'rm -rf "$SANDBOX"' EXIT
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

export OMO_SPIKE_TRACE="$SANDBOX/trace-normal.ndjson"
: > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1

echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

PROMPT="Call the task tool exactly once with subagent_type=\"explore\", model=\"$MODEL\", run_in_background=false, and prompt=\"Reply with the single token delegate-ok.\" Do not call the native subagent tool. After task returns, reply with a short summary."
(cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$PROMPT") > "$OUT/run-normal.txt" 2>&1
check "normal.run" "$?" "real task delegation session completed"
cp "$OMO_SPIKE_TRACE" "$OUT/trace-normal.ndjson"

node - "$OUT/trace-normal.ndjson" > "$OUT/trace-analysis.json" 2>&1 <<'NODE'
const fs = require("fs")
const path = process.argv[2]
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))

const analysis = {
  registration: events.some((entry) =>
    entry.event === "omo.orchestration.registered" &&
    Array.isArray(entry.tools) &&
    entry.tools.includes("task")
  ),
  started: events.some((entry) =>
    entry.event === "omo.task.start" &&
    entry.agent === "explore" &&
    entry.model === "zhipuai/glm-4.7" &&
    entry.background === false
  ),
  finishedNonEmpty: events.some((entry) =>
    entry.event === "omo.task.finished" &&
    entry.ok === true &&
    entry.background === false &&
    typeof entry.length === "number" &&
    entry.length > 0
  ),
  unusableDetections: events.filter((entry) =>
    entry.event === "omo.task.unusable-output-detected"
  ),
}
console.log(JSON.stringify(analysis, null, 2))
NODE

node -e 'const a=require(process.argv[1]);process.exit(a.registration?0:1)' "$OUT/trace-analysis.json"
check "task.registered" "$?" "live plugin registration trace includes task"
node -e 'const a=require(process.argv[1]);process.exit(a.started?0:1)' "$OUT/trace-analysis.json"
check "normal.started" "$?" "task routed to explore on the explicit live model"
node -e 'const a=require(process.argv[1]);process.exit(a.finishedNonEmpty?0:1)' "$OUT/trace-analysis.json"
check "normal.non-empty" "$?" "task finished successfully with non-empty child output"
node -e 'const a=require(process.argv[1]);process.exit(a.unusableDetections.length===0?0:1)' "$OUT/trace-analysis.json"
check "normal.not-detected" "$?" "normal output emitted no unusable-output trace"

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
