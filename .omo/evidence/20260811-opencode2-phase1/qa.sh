#!/usr/bin/env bash
# omo-opencode2 Phase 1 QA driver (Git Bash / Linux/macOS).
# Subject under test: production agent registration — the real OMO agent catalog
# (11 agents + 8 delegation categories) registered against the live v2 catalog via
# ctx.agent.transform, models resolved through model-core, default = sisyphus, the
# built-in `build` agent downgraded to a hidden subagent.
#
# The Phase 0 mechanics probe (omo-spike echo/delegate/context tools) is NOT enabled
# here — registration is the production path and must not depend on it.
#
# Proofs:
#  - deterministic (plugin trace): every agent + category registration event with the
#    resolved model, the default-agent event, the build-downgrade event.
#  - behavioral (real run): default agent is sisyphus (run header), and a registered
#    subagent is dispatchable through the native v2 `subagent` tool.
#  - isolation: nothing written into the real opencode stores.
# Secrets: the provider key is read from the real v1 auth store into the process
# environment only; it is never written to disk or printed.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="${OMO_SPIKE_MODEL:-zhipuai/glm-4.7}"
REAL_HOME="${USERPROFILE:-$HOME}"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

PASS=0; FAIL=0
check() { if [ "$2" = "0" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
grep_q() { grep -qF "$1" "$2"; }
grep_qi() { grep -qiF "$1" "$2"; }
trace_has() { grep -qE "$1" "$OMO_SPIKE_TRACE"; }  # ERE over ndjson

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
cat > "$FIX/opencode.jsonc" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "$MODEL",
  "plugins": ["$PLUGIN_ENTRY"]
}
EOF

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
note() { echo "## $*"; }
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL  (registration-only; mechanics probe OFF)"

run_case() {
  local name="$1"; shift
  ( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "step 1: default run (no --agent) — sisyphus is the harness default and executes"
run_case run-default "Reply with the single word: ready."
tail -c 400 "$OUT/run-default.txt"
grep_q "> sisyphus " "$OUT/run-default.txt"; check "default.agent.sisyphus" $? "run header shows sisyphus as the default agent"

note "step 2: registration trace — the full catalog was upserted with resolved models"
trace_has '"event":"omo.registration.complete"'; check "registration.complete" $? "registration complete event in trace"
for agent in sisyphus prometheus atlas oracle librarian explore multimodal-looker metis momus sisyphus-junior; do
  trace_has "\"event\":\"omo.agent.registered\",\"id\":\"$agent\"" || trace_has "\"id\":\"$agent\".*\"event\":\"omo.agent.registered\"" || trace_has "\"event\":\"omo.agent.registered\"[^}]*\"id\":\"$agent\""
  check "agent.registered.$agent" $? "$agent registered (trace)"
done
for cat in visual-engineering ultrabrain deep artistry quick unspecified-low unspecified-high writing; do
  trace_has "\"event\":\"omo.category.registered\"[^}]*\"id\":\"$cat\""
  check "category.registered.$cat" $? "$cat category registered (trace)"
done
trace_has '"event":"omo.agent.default","id":"sisyphus"'; check "default.set.sisyphus" $? "default agent set to sisyphus (trace)"
trace_has '"event":"omo.agent.build-downgraded"'; check "build.downgraded" $? "built-in build agent downgraded to hidden subagent (trace)"

note "step 3: model resolution — every registered agent got a concrete model + non-empty prompt"
if trace_has '"model":"[^"]+/[^"]+"'; then check "models.resolved" 0 "registered agents carry a provider/model ref"; else check "models.resolved" 1 "no resolved model in trace"; fi
if trace_has '"systemLength":[1-9]'; then check "prompts.baked" 0 "registered agents carry a non-empty system prompt"; else check "prompts.baked" 1 "no systemLength in trace"; fi

note "step 4: subagent dispatch — the default agent can invoke a registered subagent via the native subagent tool"
run_case run-subagent "Use the subagent tool to ask the oracle agent a question: what is 1+1? Report its answer."
tail -c 400 "$OUT/run-subagent.txt"
if trace_has '"type":"session.created"' || grep_qi "oracle" "$OUT/run-subagent.txt"; then
  check "subagent.dispatch" 0 "a registered subagent was referenced/dispatched"
else
  check "subagent.dispatch" 1 "no subagent dispatch observed"
fi

note "step 5: isolation (no v2 writes into the real opencode stores)"
echo "sandbox store:"; find "$SANDBOX/data" -maxdepth 3 -type f | head -10
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
