#!/usr/bin/env bash
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OUT="$EVIDENCE_DIR/out"
OC2="${OPENCODE2_BIN:-$(command -v opencode2)}"
REAL_HOME_WINDOWS="${USERPROFILE:-$HOME}"
REAL_HOME="$(cygpath -u "$REAL_HOME_WINDOWS" 2>/dev/null || printf '%s' "$REAL_HOME_WINDOWS")"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"
REAL_DB="$REAL_HOME/.local/share/opencode/opencode.db"
NO_EXCUSE_SCRIPT="$REAL_HOME/.cache/opencode/packages/oh-my-openagent@beta/node_modules/oh-my-openagent/dist/skills/programming/scripts/typescript/check-no-excuse-rules.ts"

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

real_db_count() {
  if [ ! -f "$REAL_DB" ]; then
    printf 'missing\n'
    return
  fi
  sqlite3 -readonly "$REAL_DB" 'select count(*) from session_v2;' 2>/dev/null || printf 'unavailable\n'
}

trace_has() {
  local name="$1" event="$2" min_count="$3"
  node - "$OUT/trace-$name.ndjson" "$event" "$min_count" > "$OUT/trace-check-$name-${event//./_}.json" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event, minCount] = process.argv.slice(2)
const entries = fs.readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
const matching = entries.filter((entry) => entry.event === event)
const ok = matching.length >= Number(minCount)
console.log(JSON.stringify({ event, minCount: Number(minCount), observed: matching.length, ok, samples: matching.slice(0, 3) }, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

trace_absent() {
  local name="$1" event="$2"
  node - "$OUT/trace-$name.ndjson" "$event" > "$OUT/trace-check-$name-absent-${event//./_}.json" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event] = process.argv.slice(2)
const entries = fs.readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
const matching = entries.filter((entry) => entry.event === event)
console.log(JSON.stringify({ event, observed: matching.length, ok: matching.length === 0 }, null, 2))
process.exit(matching.length === 0 ? 0 : 1)
NODE
}

[ -n "$OC2" ] && [ -x "$OC2" ] || { echo "opencode2 binary not found"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const auth=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((auth.zhipuai&&auth.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }
export ZHIPU_API_KEY

echo "## automated gates"
(cd "$ROOT" && bun test packages/omo-opencode2/src) > "$OUT/unit-green.txt" 2>&1
check "unit.gate" "$?" "full omo-opencode2 source suite"
(cd "$ROOT" && bun run typecheck) > "$OUT/typecheck.txt" 2>&1
check "typecheck.gate" "$?" "workspace typecheck"
(cd "$ROOT" && bun run "$NO_EXCUSE_SCRIPT" \
  packages/omo-opencode2/src/config/schema.ts \
  packages/omo-opencode2/src/config/schema.test.ts \
  packages/omo-opencode2/src/index.ts \
  packages/omo-opencode2/src/orchestration/session-dispatch-audit.test.ts \
  packages/omo-opencode2/src/features/model-fallback/index.ts \
  packages/omo-opencode2/src/features/model-fallback/register.ts \
  packages/omo-opencode2/src/features/model-fallback/register.test.ts \
  packages/omo-opencode2/src/features/model-fallback/runtime.ts \
  packages/omo-opencode2/src/features/model-fallback/runtime.test.ts) > "$OUT/no-excuse-audit.txt" 2>&1
check "typescript.audit" "$?" "changed TypeScript files pass the no-excuse audit"

SANDBOX="$(mktemp -d)"
MOCK_PID=""
trap '[ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null; rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX"/{data,config,cache,state,home,enabled,disabled}
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1

ISOMARK="$SANDBOX/isolation.marker"
touch "$ISOMARK"
BEFORE_COUNT="$(real_db_count)"
printf '%s\n' "$BEFORE_COUNT" > "$OUT/host-session-count-before.txt"

PORT_FILE="$SANDBOX/mock-port.txt"
node "$EVIDENCE_DIR/mock-provider.mjs" "$PORT_FILE" > "$OUT/mock-provider.log" 2>&1 &
MOCK_PID=$!
for _ in $(seq 1 50); do
  [ -s "$PORT_FILE" ] && break
  sleep 0.1
done
[ -s "$PORT_FILE" ] || { echo "mock provider failed to start"; exit 2; }
MOCK_PORT="$(cat "$PORT_FILE")"

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"

write_case() {
  local name="$1"
  local hook_config="$2"
  local case_dir="$SANDBOX/$name"
  mkdir -p "$case_dir/.omo"
  cat > "$case_dir/opencode.jsonc" <<EOF
{
  "model": "openai/gpt-5.6-sol",
  "plugins": ["$PLUGIN_JSON"],
  "provider": {
    "openai": {
      "options": { "apiKey": "mock-key", "baseURL": "http://127.0.0.1:$MOCK_PORT/v1", "timeout": 10000 },
      "models": { "gpt-5.6-sol": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } } }
    },
    "zai-coding-plan": {
      "options": { "apiKey": "mock-key", "baseURL": "http://127.0.0.1:$MOCK_PORT/v1", "timeout": 10000 },
      "models": { "glm-5.2": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } } }
    }
  }
}
EOF
  cat > "$case_dir/.omo/omo.jsonc" <<EOF
{ "[opencode2]": $hook_config }
EOF
}

run_case() {
  local name="$1"
  local case_dir="$SANDBOX/$name"
  export OMO_SPIKE_TRACE="$SANDBOX/trace-$name.ndjson"
  : > "$OMO_SPIKE_TRACE"
  (cd "$case_dir" && timeout -k 5 120 "$OC2" run --standalone --auto "Reply with the single word ok.") > "$OUT/run-$name.txt" 2>&1
  printf '%s\n' "$?" > "$OUT/run-$name.exit.txt"
  cp "$OMO_SPIKE_TRACE" "$OUT/trace-$name.ndjson"
}

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "opencode2: $(cat "$OUT/version.txt")"
echo "mock provider: 127.0.0.1:$MOCK_PORT"

echo "## enabled provider-exhaustion fallback"
write_case "enabled" '{ "model_fallback": { "enabled": true, "max_retries": 1 } }'
run_case "enabled"
trace_has "enabled" "omo.model-fallback.registered" 1
check "enabled.registered" "$?" "live plugin enabled the fallback event pump"
trace_has "enabled" "omo.model-fallback.triggered" 1
check "enabled.triggered" "$?" "forced 429 quota failure reached the reactive classifier"
trace_has "enabled" "omo.model-fallback.switched" 1
check "enabled.switched" "$?" "session switched and queued a synthetic continuation"
trace_absent "enabled" "omo.model-fallback.disabled"
check "enabled.not-disabled" "$?" "enabled case emitted no disabled trace"

echo "## disabled_hooks negative direction"
write_case "disabled" '{ "model_fallback": { "enabled": true, "max_retries": 1 }, "disabled_hooks": ["model_fallback"] }'
run_case "disabled"
trace_has "disabled" "omo.model-fallback.disabled" 1
check "disabled.traced" "$?" "disabled_hooks won over enabled config"
trace_absent "disabled" "omo.model-fallback.triggered"
check "disabled.no-trigger" "$?" "forced failure emitted no trigger while disabled"
trace_absent "disabled" "omo.model-fallback.switched"
check "disabled.no-switch" "$?" "forced failure emitted no switch while disabled"

AFTER_COUNT="$(real_db_count)"
printf '%s\n' "$AFTER_COUNT" > "$OUT/host-session-count-after.txt"
if [ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && [ "$BEFORE_COUNT" != "unavailable" ]; then
  check "isolation.session-count" 0 "host session_v2 count unchanged: $BEFORE_COUNT"
else
  check "isolation.session-count" 1 "host session_v2 count changed or unavailable: $BEFORE_COUNT -> $AFTER_COUNT"
fi

REAL_STORES=()
for path in "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" "$REAL_HOME/.cache/opencode" "$REAL_HOME/.local/state/opencode"; do
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
  check "isolation.sweep" 1 "host stores contain unexpected newer files"
else
  check "isolation.sweep" 0 "newer-than-marker sweep found no unexpected host-store writes"
fi

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
