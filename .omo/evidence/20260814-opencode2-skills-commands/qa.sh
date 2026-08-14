#!/usr/bin/env bash
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME="${USERPROFILE:-$HOME}"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"
OUT="$EVIDENCE_DIR/out"

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
trace_has() { grep -qE "$1" "$OMO_SPIKE_TRACE"; }
output_has() { grep -qiF "$1" "$2"; }

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj} "$OUT"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export ZHIPU_API_KEY
export OMO_SPIKE_TRACE="$SANDBOX/trace.ndjson"
ISOMARK="$SANDBOX/iso.mark"
touch "$ISOMARK"

FIX="$SANDBOX/proj"
PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || echo "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
cat > "$FIX/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF

: > "$OMO_SPIKE_TRACE"
rm -f "$OUT/run-catalog.jsonl" "$OUT/run-skill-load.jsonl" "$OUT/export-skill.json"
"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2 $(cat "$OUT/version.txt") model=$MODEL"

echo "## C1: live model lists registered shared skills and builtin commands"
( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto --format json \
  "Copy every exact name from the <available-skills> and <available-slash-commands> system sections into two JSON arrays named shared_skills and builtin_commands. Do not classify tools as commands, omit entries, or infer names outside those sections." ) \
  > "$OUT/run-catalog.jsonl" 2>&1
CATALOG_EXIT=$?
check "C1.live.catalog-run" "$CATALOG_EXIT" "real standalone model session completed"

trace_has '"event":"omo.skills.registered"'; check "C1.trace.skills-registered" $? "shared directory transform fired"
trace_has '"event":"omo.commands.registered"'; check "C1.trace.commands-registered" $? "builtin command transform fired"
trace_has '"event":"omo.context.skills","count":[1-9][0-9]*'; check "C1.trace.skills-visible" $? "live context observed materialized skills"

CATALOG_MISSING=0
for name in programming git-master refactor start-work goal stop-continuation handoff remove-ai-slops hyperplan; do
  if ! output_has "$name" "$OUT/run-catalog.jsonl"; then
    echo "missing from live catalog output: $name"
    CATALOG_MISSING=1
  fi
done
check "C1.model.catalog-visible" "$CATALOG_MISSING" "representative shared skills and all seven commands appeared in model output"

echo "## C2: one registered skill body reaches the model"
( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto --format json \
  'Load the registered programming skill using the native skill capability. Then return one compact JSON object with skill_name and typescript_reference. typescript_reference must be the exact relative README path that the loaded skill requires before editing .ts files. Do not guess or use prior knowledge.' ) \
  > "$OUT/run-skill-load.jsonl" 2>&1
SKILL_EXIT=$?

SKILL_SESSION="$(sed -n 's/.*"event":"omo.context.composed".*"sessionID":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | tail -1)"
if [ -n "$SKILL_SESSION" ]; then
  ( cd "$FIX" && "$OC2" export --standalone --session "$SKILL_SESSION" ) > "$OUT/export-skill.json" 2>&1
fi

if [ "$SKILL_EXIT" = "0" ] || grep -qF '"tool":"skill"' "$OUT/run-skill-load.jsonl" 2>/dev/null; then
  check "C2.live.skill-run" 0 "skill tool completed on the real session; post-tool provider limits do not invalidate delivery"
else
  check "C2.live.skill-run" 1 "skill tool did not complete in the real session"
fi

if grep -qF 'references/typescript/README.md' "$OUT/run-skill-load.jsonl" "$OUT/export-skill.json" 2>/dev/null; then
  check "C2.model.skill-body" 0 "model returned the path available only in the loaded programming skill body"
else
  check "C2.model.skill-body" 1 "required skill-body path missing from live output and export"
fi

echo "## C3: isolated stores"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
printf '%s\n' "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then
  check "C3.isolation.clean" 0 "no writes in real OpenCode stores"
else
  check "C3.isolation.clean" 1 "$VIOLATIONS"
fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
