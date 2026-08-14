#!/usr/bin/env bash
# omo-opencode2 config chain QA driver.
# Subject under test: the omo-config-core loader resolves user, project, and
# [opencode2] layers, applying them to the v2 adapter's default_agent and
# per-agent model overrides.
#
# Proofs:
#  - (C5) missing config runs without crashing, registering agents natively
#  - (C3) [opencode2].default_agent override is observable in trace and transcript
#  - (C4) per-agent model override flows through to omo.agent.registered trace
#  - isolation: nothing written into the real opencode stores
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME="${USERPROFILE:-$HOME}"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

PASS=0; FAIL=0
check() { if [ "$2" = "0" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
grep_q() { grep -qF "$1" "$2"; }
trace_has() { grep -qE "$1" "$OMO_SPIKE_TRACE"; }

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
echo "sandbox: $SANDBOX"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj}
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home" USERPROFILE="$SANDBOX/home" OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 ZHIPU_API_KEY
export OMO_SPIKE_TRACE="$SANDBOX/trace.ndjson"
ISOMARK="$SANDBOX/iso.mark"; touch "$ISOMARK"

FIX="$SANDBOX/proj"
mkdir -p "$FIX/.omo"
PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || echo "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"

cat > "$FIX/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
note() { echo "## $*"; }
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL  (config chain)"

run_case() {
  local name="$1"; shift
  ( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "C5: no-config fails soft, registers agents normally"
run_case run-no-config "reply with a greeting from the main agent."
trace_has '"event":"omo.config.loaded".*"diagnostics":0'; check "config.fallback" $? "missing config degrades gracefully"
trace_has '"event":"omo.agent.default","id":"sisyphus"'; check "config.default_agent.fallback" $? "defaults to sisyphus when unset"
trace_has '"event":"omo.agent.registered","id":"oracle"'; check "config.agent.registration" $? "agents register normally"
grep_q "Hello" "$OUT/run-no-config.txt"; check "config.session.works" $? "session runs normally without config"

note "C3/C4: [opencode2] default_agent override + per-agent model override"
cat > "$FIX/.omo/omo.jsonc" <<EOF
{
  "agents": {
    "oracle": { "model": "anthropic/claude-3-5-sonnet" }
  },
  "[opencode2]": {
    "default_agent": "hephaestus",
    "agents": {
      "oracle": { "model": "openai/gpt-4o" }
    }
  }
}
EOF

: > "$OMO_SPIKE_TRACE"
run_case run-with-config "reply with the single word ok."
trace_has '"event":"omo.config.loaded".*"diagnostics":0'; check "config.load.success" $? "config loaded without diagnostics"
trace_has '"event":"omo.config.effective".*"default_agent":"hephaestus"'; check "config.effective.default_agent" $? "hephaestus is the effective default_agent"
trace_has '"event":"omo.agent.default","id":"hephaestus"'; check "config.default_agent.override" $? "registerPrimaries consumed the default_agent override"
trace_has '"event":"omo.agent.registered","id":"oracle","mode":"subagent","model":"openai/gpt-4o"'; check "config.model.override" $? "oracle model override flowed through registration"

note "step 3: isolation (no v2 writes into the real opencode stores)"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]