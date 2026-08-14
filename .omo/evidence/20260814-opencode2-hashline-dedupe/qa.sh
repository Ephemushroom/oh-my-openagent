#!/usr/bin/env bash
# OpenCode2 hashline dedupe QA against the real pinned Windows binary.
#
# Reproduces the exact failure found while QA'ing the tool guards: the flat
# hooks/hashline-read-enhancer.ts shipped by the duplicate hashline PR
# dereferenced event.result.content BEFORE its read-tool guard clause, so any
# tool whose result was absent (a failed `edit`) crashed the execute.after hook
# with "undefined is not an object (evaluating 'event.result.content')".
#
# This drives a real read-then-edit round trip and asserts the crash string is
# absent while the hashline read tagging still applies.
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

printf 'export const value = 1\nexport const other = 2\n' > "$FIX/target.ts"

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

CRASH="undefined is not an object"

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

echo "## read then edit round trip (the crash repro)"
run_case "edit" "Read target.ts, then change the exported value from 1 to 3."
check "edit.run" "$?" "real session completed"

if grep -qF "$CRASH" "$OUT/run-edit.txt"; then
  check "edit.no-crash" 1 "execute.after still crashed on the edit result"
else
  check "edit.no-crash" 0 "no 'undefined is not an object' crash in the transcript"
fi

# Tagging is asserted on the trace, not the transcript: the CLI prints a
# "Read <file>" summary rather than the raw tool result, so the tags are only
# observable where they are actually delivered (the model-facing result).
if grep -qF '"event":"omo.hashline.tag-applied"' "$OUT/trace-edit.ndjson"; then
  check "edit.hashline-tagged" 0 "read result was tagged (omo.hashline.tag-applied on tool read)"
else
  check "edit.hashline-tagged" 1 "read result was never tagged"
fi

# Independent corroboration that the tags reached the model: a hashline_edit
# call can only cite a real LINE#ID position if the read it saw was tagged.
if grep -qE '"pos":"[0-9]+#[ZPMQVRWSNKTXJBYH]{2}"' "$OUT/run-edit.txt"; then
  check "edit.model-saw-tags" 0 "model cited a real LINE#ID position in hashline_edit"
else
  check "edit.model-saw-tags" 1 "model never cited a real LINE#ID position"
fi

if grep -q "value = 3" "$FIX/target.ts"; then
  check "edit.applied" 0 "the edit actually landed in target.ts"
else
  check "edit.applied" 1 "target.ts was not modified"
fi

echo "## single resolved implementation"
DUPES=0
for stray in \
  "$ROOT/packages/omo-opencode2/src/hooks/hashline-read-enhancer.ts" \
  "$ROOT/packages/omo-opencode2/src/tools/hashline-edit.ts"
do
  [ -f "$stray" ] && { echo "stray duplicate still present: $stray"; DUPES=1; }
done
check "dedupe.single-impl" "$DUPES" "no flat duplicate shadows the directory module"

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
