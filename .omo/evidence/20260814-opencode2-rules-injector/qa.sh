#!/usr/bin/env bash
# OpenCode2 rules-context QA against the real pinned Windows binary.
# Proves project rules and AGENTS.md are injected only when present by asserting
# the plugin trace rather than the summarized CLI transcript.
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
mkdir -p "$SANDBOX"/{data,config,cache,state,home,present,absent}
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

write_config() {
  local project="$1"
  cat > "$project/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
  printf '{}\n' > "$project/package.json"
}

write_config "$SANDBOX/present"
mkdir -p "$SANDBOX/present/.omo/rules"
printf 'AGENTS_QA_CONTEXT\n' > "$SANDBOX/present/AGENTS.md"
cat > "$SANDBOX/present/.omo/rules/always.md" <<'EOF'
---
alwaysApply: true
---
RULES_QA_CONTEXT
EOF

write_config "$SANDBOX/absent"

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

run_case() {
  local name="$1"
  local project="$2"
  export OMO_SPIKE_TRACE="$SANDBOX/trace-$name.ndjson"
  : > "$OMO_SPIKE_TRACE"
  (cd "$project" && timeout -k 5 300 "$OC2" run --standalone --auto "Reply with the single word ok.") > "$OUT/run-$name.txt" 2>&1
  local status=$?
  cp "$OMO_SPIKE_TRACE" "$OUT/trace-$name.ndjson"
  return "$status"
}

trace_rules_state() {
  local name="$1"
  local expected="$2"
  node - "$OUT/trace-$name.ndjson" "$expected" > "$OUT/trace-check-$name.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, expected] = process.argv.slice(2)
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matching = events.filter((event) => event.event === "omo.context.rules")
const valid = matching.filter((event) => {
  if (expected === "present") {
    return event.injected === true
      && event.ruleFiles >= 1
      && event.agentsFiles >= 1
      && event.systemParts >= 2
      && event.diagnostics === 0
  }
  return event.injected === false
    && event.ruleFiles === 0
    && event.agentsFiles === 0
    && event.systemParts === 0
    && event.diagnostics === 0
})
const ok = matching.length > 0 && valid.length === matching.length
console.log(JSON.stringify({ expected, observed: matching.length, valid: valid.length, ok, samples: matching.slice(0, 3) }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

echo "## project rules and AGENTS.md present"
run_case "present" "$SANDBOX/present"
check "present.run" "$?" "real session completed"
trace_rules_state "present" "present"
check "present.injected" "$?" "trace reports both project rule and AGENTS.md system parts"

echo "## project rules and AGENTS.md absent"
run_case "absent" "$SANDBOX/absent"
check "absent.run" "$?" "real session completed"
trace_rules_state "absent" "absent"
check "absent.not-injected" "$?" "trace reports zero files and zero added system parts"

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
