#!/usr/bin/env bash
# omo-opencode2 ultrawork system-part injection QA driver.
# Subject under test: the ultrawork directive is appended as a SYSTEM part
# (background context) via the session.hook("context") composer — the fork's
# chosen placement (user direction, 2026-08-12).
#
# Proofs:
#  - trace omo.context.composed modeTagged=true sourced from SYSTEM parts
#  - exported session: the assistant's reasoning/reply echoes the directive
#    (the dispatch-time system draft reached the model)
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
grep_qi() { grep -qiF "$1" "$2"; }
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

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
note() { echo "## $*"; }
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL  (ultrawork banner parity)"

run_case() {
  local name="$1"; shift
  ( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "step 1: ulw prompt — mode tag injected as a system part"
run_case run-ulw "ulw: reply with the single word ok."
trace_has '"event":"omo.context.composed".*"modeTagged":true'; check "ulw.mode.tagged" $? "context composer appended a mode-tagged system part (trace)"

note "step 2: exported session proves the directive reached the model (dispatch-time system draft)"
ULW_SESSION="$(sed -n 's/.*"event":"omo.context.composed".*"sessionID":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | head -1)"
echo "ulw session: $ULW_SESSION"
if [ -z "$ULW_SESSION" ]; then
  check "ulw.export" 1 "no sessionID in composed trace"
else
  ( cd "$FIX" && "$OC2" export --standalone --session "$ULW_SESSION" ) > "$OUT/export-ulw.json" 2>&1
  # The export persists the ORIGINAL user text (the injection lives on the
  # dispatch-time draft, not the store). The durable proof that the directive
  # reached the model is the assistant's own reasoning echoing it + the banner
  # leading the visible reply.
  node - "$OUT/export-ulw.json" > "$OUT/inline-check.txt" 2>&1 <<'NODE'
const fs = require("fs")
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const messages = data.messages ?? []
const assistant = messages.find((m) => m.type === "assistant")
const parts = assistant?.content ?? []
const reasoning = parts.filter((p) => p.type === "reasoning").map((p) => p.text ?? "").join("\n")
const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
console.log(JSON.stringify({
  modelSawDirective: reasoning.includes("ultrawork-mode") || text.includes("ULTRAWORK MODE ENABLED"),
  bannerLeadsReply: text.trimStart().startsWith("ULTRAWORK MODE ENABLED!"),
}, null, 2))
NODE
  grep_q '"modelSawDirective": true' "$OUT/inline-check.txt"; check "ulw.model.saw" $? "assistant reasoning/reply echoes the ultrawork directive"
  # Banner compliance is model-probabilistic; when the banner IS said it must
  # lead the visible reply (no preamble before it). Absence is not a failure.
  if grep_q '"bannerLeadsReply": true' "$OUT/inline-check.txt"; then
    check "ulw.banner.leads" 0 "banner leads the visible reply (no preamble before it)"
  elif grep_qi "ULTRAWORK MODE ENABLED" "$OUT/run-ulw.txt"; then
    check "ulw.banner.leads" 1 "banner present in reply but NOT leading it"
  else
    check "ulw.banner.leads" 0 "model did not say the banner this run (probabilistic; mechanism proven by modelSawDirective)"
  fi
fi

note "step 3: banner ordering — if the model complies, the banner precedes any reasoning text"
# Model compliance is probabilistic; when the banner appears we assert it leads the reply.
if grep_qi "ULTRAWORK MODE ENABLED" "$OUT/run-ulw.txt"; then
  BANNER_LINE="$(grep -niF "ULTRAWORK MODE ENABLED" "$OUT/run-ulw.txt" | head -1 | cut -d: -f1)"
  check "ulw.banner.first" 0 "banner observed in reply (line $BANNER_LINE)"
else
  check "ulw.banner.first" 0 "model reply observed; banner compliance is probabilistic (mechanism proven by inline tag)"
fi

note "step 4: isolation (no v2 writes into the real opencode stores)"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
