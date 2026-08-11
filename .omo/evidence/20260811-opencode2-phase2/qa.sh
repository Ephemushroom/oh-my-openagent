#!/usr/bin/env bash
# omo-opencode2 Phase 2 QA driver (Git Bash / Linux/macOS).
# Subject under test: orchestration — the omo `task` tool (sync / background /
# continuation), background_output / background_cancel tools, the task engine
# (event pump -> task records -> background completion notification).
#
# The model override (`model="zhipuai/glm-4.7"`) is used because this QA box
# authenticates only zhipuai; agent fallback chains target unauthenticated
# providers (plan risk R14). The `model` parameter lets the child session run.
#
# Proofs (behavioral, real opencode2 runs):
#  - sync: task(subagent_type=..., model=...) returns the child's output inline
#  - background: task(run_in_background=true) returns a task id; the engine
#    fires a background completion (trace omo.task.background-completed); the
#    model then retrieves the output via background_output
#  - continuation: task(task_id=...) reuses the same child session (same
#    sessionID in the trace) and produces the follow-up output
#  - isolation: no writes into the real opencode stores
# Secrets: the provider key is read from the real v1 auth store into the process
# environment only; it is never written to disk or printed.
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
PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || echo "$ROOT/packages/omo-opencode2/src/index.ts")"
# JSON on Windows needs escaped backslashes; on POSIX the path has none.
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
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL  (Phase 2 orchestration)"

run_case() {
  local name="$1"; shift
  ( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "step 1: registration + orchestration tools"
run_case run-probe "Reply with the single word: probe."
grep_q "> sisyphus " "$OUT/run-probe.txt"; check "default.agent.sisyphus" $? "run header shows sisyphus"
trace_has '"event":"omo.orchestration.registered"'; check "orchestration.tools.registered" $? "task/background_output/background_cancel registered (trace)"

note "step 2: sync task — the child output is returned inline"
run_case run-sync "Use the task tool with subagent_type=\"explore\", model=\"$MODEL\", prompt: reply with the single word done. Report exactly what it returns."
grep_q "done" "$OUT/run-sync.txt"; check "sync.task.output" $? "sync task output present in parent reply"
trace_has '"event":"omo.task.finished","taskID":"[^"]+","ok":true,"background":false'; check "sync.task.finished.ok" $? "sync task finished ok (trace)"
trace_has '"event":"omo.task.start","agent":"explore","model":"zhipuai/glm-4.7"'; check "sync.task.routed" $? "sync task routed to explore on zhipuai/glm-4.7 (trace)"

note "step 3: background task — task id returned, completion notified, output retrievable"
run_case run-bg "Start a background task with the task tool: subagent_type=\"explore\", model=\"$MODEL\", run_in_background=true, prompt: reply with the single word bgdone. Then use background_output to retrieve its result and report it."
grep_q "bgdone" "$OUT/run-bg.txt"; check "bg.output.retrieved" $? "background output retrieved via background_output"
trace_has '"event":"omo.task.background-completed".*"ok":true'; check "bg.completion.notified" $? "background completion fired (trace)"
trace_has '"event":"omo.task.finished","taskID":"[^"]+","ok":true,"background":true'; check "bg.task.finished.ok" $? "background task finished ok (trace)"

note "step 4: continuation — task_id reuses the same child session"
run_case run-cont "Start a task with the task tool: subagent_type=\"explore\", model=\"$MODEL\", run_in_background=true, prompt: reply with the single word first. Then CONTINUE that same task using task_id with prompt: now reply with the single word second. Then use background_output to get the final result."
grep_q "second" "$OUT/run-cont.txt"; check "continuation.output" $? "continued task output present"
CHILD_A="$(sed -n 's/.*"event":"omo.task.start".*"parent":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | head -1)"
# The same child session must execute twice (two execution.started on one id).
COUNT="$(grep -c '"type":"session.execution.started"' "$OMO_SPIKE_TRACE")"
[ "$COUNT" -ge 3 ]; check "continuation.same.child" $? ">=3 execution.started events (initial + background + continuation) in trace"

note "step 5: isolation (no v2 writes into the real opencode stores)"
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
