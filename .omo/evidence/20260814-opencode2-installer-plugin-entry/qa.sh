#!/usr/bin/env bash
# omo-opencode2 installer plugin entry QA driver.
# Subject under test: the omo-agent-toolkit install --platform=opencode2 command
# correctly adds the absolute path of omo-opencode2 to the plugins array.
#
# Proofs:
#  - C3: TEMP config has correct plugins entry; REAL config is untouched.
#  - C4: opencode2 run using the modified config traces omo.registration.complete,
#    proving the plugin was actually loaded by the real binary.
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
grep_qi() { grep -qiF "$1" "$2"; }
trace_has() { grep -qE "$1" "$OMO_SPIKE_TRACE"; }

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
echo "sandbox: $SANDBOX"
mkdir -p "$SANDBOX"/{data,config/opencode,cache,state,home,proj}
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home" USERPROFILE="$SANDBOX/home" OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 ZHIPU_API_KEY
export OMO_SPIKE_TRACE="$SANDBOX/trace.ndjson"
ISOMARK="$SANDBOX/iso.mark"; touch "$ISOMARK"

REAL_CONFIG="$REAL_HOME/.config/opencode/opencode.json"
REAL_CONFIG_HASH=""
[ -f "$REAL_CONFIG" ] && REAL_CONFIG_HASH="$(sha256sum "$REAL_CONFIG" | cut -d' ' -f1)"

# Step 1: Create a fresh config in sandbox
SANDBOX_CONFIG="$SANDBOX/config/opencode/opencode.json"
cat > "$SANDBOX_CONFIG" <<EOF
{
  "model": "$MODEL"
}
EOF

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
note() { echo "## $*"; }
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL"

run_case() {
  local name="$1"; shift
  ( cd "$SANDBOX/proj" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "step 1: run installer to modify sandbox config"
( cd "$ROOT" && bun -e 'import { runCli } from "./packages/omo-opencode/src/cli/cli-program.ts"; runCli()' install --no-tui --platform=opencode2 --claude=no --openai=no --gemini=no --copilot=no --opencode-zen=no --zai-coding-plan=no --kimi-for-coding=no --opencode-go=no --bailian-coding-plan=no --minimax-cn-coding-plan=no --minimax-coding-plan=no --vercel-ai-gateway=no ) > "$OUT/install.txt" 2>&1
cp "$SANDBOX_CONFIG" "$OUT/sandbox_opencode.json"
grep_q '"plugins":' "$OUT/sandbox_opencode.json"; check "installer.plugins.key" $? "plugins array added to config"
grep_q 'omo-opencode2' "$OUT/sandbox_opencode.json"; check "installer.plugins.value" $? "omo-opencode2 path added to plugins"
grep_q 'OpenCode2 config' "$OUT/install.txt"; check "installer.logs.mcp" $? "installer still writes mcp.servers and plugin"

note "step 2: check isolation of REAL config"
if [ -f "$REAL_CONFIG" ]; then
  NEW_HASH="$(sha256sum "$REAL_CONFIG" | cut -d' ' -f1)"
  [ "$REAL_CONFIG_HASH" = "$NEW_HASH" ]; check "isolation.real_config.unchanged" $? "real opencode.json unchanged"
else
  [ ! -f "$REAL_CONFIG" ]; check "isolation.real_config.unchanged" $? "real opencode.json still absent"
fi

note "step 3: live QA - plugin loads from installer config"
run_case run-live "reply with the single word ok."
trace_has '"event":"omo.registration.complete"'; check "plugin.loaded" $? "omo.registration.complete trace event fired"
trace_has '"event":"omo.catalog.snapshot"'; check "plugin.catalog" $? "omo.catalog.snapshot trace event fired"

note "step 4: isolation (no v2 writes into the real opencode stores)"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]