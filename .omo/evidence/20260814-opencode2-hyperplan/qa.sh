#!/usr/bin/env bash
# OpenCode2 hyperplan keyword QA against the real pinned Windows binary.
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

trace_matches() {
  local name="$1"
  local ultrawork="$2"
  local hyperplan="$3"
  local combo="$4"
  node - "$OUT/trace-$name.ndjson" "$ultrawork" "$hyperplan" "$combo" > "$OUT/trace-check-$name.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, ultrawork, hyperplan, combo] = process.argv.slice(2)
const expected = {
  ultraworkParts: Number(ultrawork),
  hyperplanParts: Number(hyperplan),
  hyperplanUltraworkParts: Number(combo),
}
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((event) => event.event === "omo.context.composed")
const matched = events.some((event) =>
  event.ultraworkParts === expected.ultraworkParts &&
  event.hyperplanParts === expected.hyperplanParts &&
  event.hyperplanUltraworkParts === expected.hyperplanUltraworkParts
)
console.log(JSON.stringify({ expected, composedEvents: events.length, matched }, null, 2))
process.exit(matched ? 0 : 1)
NODE
}

echo "## standalone hyperplan"
run_case "hyperplan" "hyperplan: assess this placeholder and reply briefly."
check "hyperplan.run" "$?" "real session completed"
trace_matches "hyperplan" 0 1 0
check "hyperplan.injected" "$?" "one standalone hyperplan system part and no ultrawork/combo part"

echo "## adjacent hyperplan plus ultrawork"
run_case "combo" "hyperplan ultrawork: assess this placeholder and reply briefly."
check "combo.run" "$?" "real session completed"
trace_matches "combo" 1 0 1
check "combo.injected" "$?" "one combo system part embeds exactly one routed ultrawork part"

echo "## no keyword"
run_case "negative" "Reply with the single word ok."
check "negative.run" "$?" "real session completed"
trace_matches "negative" 0 0 0
check "negative.clean" "$?" "no keyword mode system part was injected"

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
    ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" \
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
