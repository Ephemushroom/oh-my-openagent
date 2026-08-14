#!/usr/bin/env bash
# OpenCode2 probe-removal QA against the real pinned Windows binary.
# Proves the plugin loads and registers its full surface after the
# OMO_SPIKE_MECHANICS mechanics probe is removed from setup().
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
  if [ "$2" = "0" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS + 1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL + 1)); fi
}

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj}
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home" USERPROFILE="$SANDBOX/home" OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY

FIX="$SANDBOX/proj"
ISOMARK="$SANDBOX/isolation.marker"
touch "$ISOMARK"

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
cat > "$FIX/opencode.jsonc" <<EOF
{ "model": "$MODEL", "plugins": ["$PLUGIN_JSON"] }
EOF

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "opencode2: $(cat "$OUT/version.txt")  model: $MODEL"
echo "probe flag intentionally NOT set: OMO_SPIKE_MECHANICS=${OMO_SPIKE_MECHANICS:-<unset>}"

export OMO_SPIKE_TRACE="$SANDBOX/trace-load.ndjson"
: > "$OMO_SPIKE_TRACE"
(cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "Reply with the single word ok.") > "$OUT/run-load.txt" 2>&1
check "load.run" "$?" "real session completed with probe removed"
cp "$OMO_SPIKE_TRACE" "$OUT/trace-load.ndjson"

trace_has() {
  node - "$OUT/trace-load.ndjson" "$1" > "$OUT/trace-check-${1//./_}.txt" 2>&1 <<'NODE'
const fs=require("fs");const [path,event]=process.argv.slice(2);
const events=fs.readFileSync(path,"utf8").split(/\r?\n/).filter(Boolean).map((l)=>JSON.parse(l));
const m=events.filter((e)=>e.event===event);
console.log(JSON.stringify({event,observed:m.length,ok:m.length>=1,samples:m.slice(0,2)},null,2));
process.exit(m.length>=1?0:1)
NODE
}
trace_absent() {
  node - "$OUT/trace-load.ndjson" "$1" > "$OUT/trace-absent-${1//./_}.txt" 2>&1 <<'NODE'
const fs=require("fs");const [path,event]=process.argv.slice(2);
const events=fs.readFileSync(path,"utf8").split(/\r?\n/).filter(Boolean).map((l)=>JSON.parse(l));
const m=events.filter((e)=>e.event===event);
console.log(JSON.stringify({event,observed:m.length,ok:m.length===0},null,2));
process.exit(m.length===0?0:1)
NODE
}

trace_has "omo.registration.complete"; check "load.agents" "$?" "11-agent catalog registered"
trace_has "omo.orchestration.registered"; check "load.orchestration" "$?" "task/background/hashline tools registered"
trace_has "omo.tool-guards.registered"; check "load.guards" "$?" "tool guards registered"
trace_has "omo.context-hooks.registered"; check "load.context" "$?" "context composer registered"
trace_has "omo.skills.registered"; check "load.skills" "$?" "shared skills registered"
# The probe was removed; its trace events must NOT appear even though the flag is unset.
trace_absent "agents.registered"; check "probe.agents-absent" "$?" "spike probe agent registration did not fire"
trace_absent "tools.registered"; check "probe.tools-absent" "$?" "spike probe tool registration did not fire"

echo "## host-store isolation"
REAL_STORES=()
for path in "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" "$REAL_HOME/.cache/opencode" "$REAL_HOME/.local/state/opencode"; do
  [ -d "$path" ] && REAL_STORES+=("$path")
done
if [ "${#REAL_STORES[@]}" -eq 0 ]; then : > "$OUT/isolation-violations.txt"; else
  find "${REAL_STORES[@]}" -newer "$ISOMARK" -type f \
    ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
    ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" ! -name "models.json" \
    > "$OUT/isolation-violations.txt" 2>/dev/null
fi
if [ -s "$OUT/isolation-violations.txt" ]; then check "isolation.clean" 1 "host stores contain newer files"; else check "isolation.clean" 0 "no host-store writes"; fi

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
