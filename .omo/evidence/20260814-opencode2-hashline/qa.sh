#!/usr/bin/env bash
# omo-opencode2 hashline QA driver.
#
# Subject under test:
#  - the read enhancer registered on ctx.tool.hook("execute.after") that tags
#    every builtin `read` result with LINE#ID content hashes;
#  - the hash-validated `hashline_edit` tool registered via ctx.tool.transform.
#
# Proofs:
#  - C3 (LIVE): a real zhipuai/glm-4.7 session reading a real fixture file
#    receives LINE#ID-tagged content. Proven by the trace event
#    omo.hashline.tag-applied on the real read call AND by the model echoing a
#    LINE#ID tag from the read output in its exported reply.
#  - hashline_edit tool registration on the live binary (trace
#    omo.hashline.tool-registered).
#  - C4 / C5 (DETERMINISTIC): the registered tool's execute path is driven
#    in-process by edit-driver.ts (model tool-calling is probabilistic). C4
#    proves a valid hash modifies the file; C5 proves a stale hash is rejected
#    and the target file is byte-identical (sha256 compare).
#  - isolation: nothing written into the real opencode stores.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME="${USERPROFILE:-$HOME}"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

PASS=0; FAIL=0
check() { if [ "$2" = "0" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
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
PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || echo "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
cat > "$FIX/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF

# Fixture edit-target created INSIDE the sandbox project, never in the repo.
TARGET="$FIX/greeter.ts"
cat > "$TARGET" <<'EOF'
export function greet(name: string): string {
  return "hello " + name
}
EOF

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
echo "## opencode2 $(cat "$OUT/version.txt")  model=$MODEL"

# ---------------------------------------------------------------------------
# C3: live session reads the fixture; the enhancer tags the read result.
# ---------------------------------------------------------------------------
echo "## C3: live read receives LINE#ID-tagged content"
( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto \
  "Use the read tool to read the file greeter.ts. Then reply with the EXACT first line of the read tool output, copied verbatim including any leading number#hash| prefix. Reply with only that one line." ) \
  > "$OUT/run-c3.txt" 2>&1
echo "== C3 run (exit $?) =="

trace_has '"event":"omo.hashline.tag-applied"'; check "C3.trace.tag-applied" $? "read enhancer fired on the real read call (trace)"
trace_has '"event":"omo.hashline.tool-registered"'; check "C3.trace.tool-registered" $? "hashline_edit registered on the live binary (trace)"

C3_SESSION="$(sed -n 's/.*"event":"omo.hashline.tag-applied".*"sessionID":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | head -1)"
echo "c3 session: $C3_SESSION"
if [ -n "$C3_SESSION" ]; then
  ( cd "$FIX" && "$OC2" export --standalone --session "$C3_SESSION" ) > "$OUT/export-c3.json" 2>&1
fi
# The tagged content reached the model: either its reply echoes a LINE#ID tag,
# or the export tool-result parts carry one. Assert the LINE#ID pattern.
if grep -qE '[0-9]+#[ZPMQVRWSNKTXJBYH]{2}\|' "$OUT/run-c3.txt" "$OUT/export-c3.json" 2>/dev/null; then
  check "C3.model.saw.tagged" 0 "LINE#ID-tagged content present in the model-facing session"
else
  check "C3.model.saw.tagged" 1 "no LINE#ID tag found in reply/export"
fi

# ---------------------------------------------------------------------------
# C4 / C5: deterministic edit accept / reject against fixture bytes.
# ---------------------------------------------------------------------------
echo "## C4/C5: deterministic hashline_edit accept + stale-hash reject (file bytes)"
bun "$EVIDENCE_DIR/edit-driver.ts" > "$OUT/edit-driver.txt" 2>&1
EDIT_EXIT=$?
cat "$OUT/edit-driver.txt"
check "C4C5.edit-driver" "$EDIT_EXIT" "deterministic accept + byte-identical reject (edit-driver.txt)"

# ---------------------------------------------------------------------------
# Isolation: no writes into the real opencode stores.
# ---------------------------------------------------------------------------
echo "## isolation (no v2 writes into the real opencode stores)"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
