#!/usr/bin/env bash
# QA for the todo continuation enforcer (packages/omo-opencode2).
#
# Proves against the REAL opencode2 binary, in an isolated sandbox:
#   RUN A (enforcer alone, goal OFF): a session left with an unfinished todo
#     injects EXACTLY ONE continuation. This is the positive direction. Without
#     it, RUN B's "they did not both inject" would pass for the wrong reason,
#     because an enforcer that never fires also never double-fires.
#   RUN B (goal ON + enforcer ON): two independent idle injectors observing the
#     SAME idle edge produce AT MOST ONE injection between them. This is the
#     path PR-4 could only unit-test, since goal was the only injector.
#   Both runs: the host opencode stores are untouched.
#
# Assertions read the OMO_SPIKE_TRACE NDJSON, never CLI prose.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/out"
mkdir -p "$OUT"

BIN="${OPENCODE2_BIN:-$HOME/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "FATAL: opencode2 binary not found at $BIN"; exit 1; }

KEY="$(node -e 'try{const a=require(process.env.HOME+"/.local/share/opencode/auth.json");process.stdout.write(a.zhipuai?.key||"")}catch{}')"
[ -n "$KEY" ] || { echo "FATAL: no zhipuai key in the host auth store"; exit 1; }

HOST_DB="$(cygpath -u "$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')" 2>/dev/null || true)/.local/share/opencode/opencode.db"
host_count() { [ -f "$HOST_DB" ] && stat -c %s "$HOST_DB" 2>/dev/null || echo "absent"; }
BEFORE="$(host_count)"

PASS=0; FAIL=0
check() {
  if [ "$2" = "1" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1))
  else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi
}
events() { local n; n="$(grep -c "\"event\":\"$2\"" "$1" 2>/dev/null)" || n=0; printf '%s' "$n"; }

# $1 = label, $2 = goal enabled (true|false), $3 = prompt. Echoes the trace path.
run_case() {
  local label="$1" goal_enabled="$2" prompt="$3"
  local S; S="$(mktemp -d)"
  export HOME="$S/home" USERPROFILE="$S/home"
  export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config"
  export XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
  export OPENCODE_TEST_HOME="$S/home"
  export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
  export ZHIPU_API_KEY="$KEY"
  # Config layers walk cwd up to $HOME, so the project must live under it.
  local PROJ="$S/home/project"
  mkdir -p "$PROJ/.omo" "$XDG_CONFIG_HOME/opencode"

  # opencode2 is a native Windows binary and cannot resolve MSYS /d/... paths,
  # so the config must carry a mixed path (D:/...), which is also JSON-safe.
  local PLUGIN; PLUGIN="$(cygpath -m "$(cd "$REPO/packages/omo-opencode2" && pwd)")/src/index.ts"
  cat > "$PROJ/opencode.jsonc" <<EOF
{ "plugins": ["$PLUGIN"] }
EOF
  cat > "$PROJ/.omo/omo.json" <<EOF
{
  "[opencode2]": {
    "goal": { "enabled": $goal_enabled },
    "todo_continuation": { "enabled": true, "max_consecutive": 2 },
    "agents": { "sisyphus": { "model": "zhipuai/glm-4.7" } }
  }
}
EOF

  export OMO_SPIKE_TRACE="$S/trace.ndjson"; : > "$OMO_SPIKE_TRACE"
  cd "$PROJ" || return 1
  timeout 180 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 \
    "$prompt" > "$OUT/run-$label.txt" 2>&1
  # Progress goes to stderr: stdout is the function's return channel, and a
  # stray echo here lands inside the captured trace path.
  echo "  [$label] run exit: $?" >&2
  cp "$OMO_SPIKE_TRACE" "$S/keep.ndjson" >&2
  printf '%s' "$S/keep.ndjson"
}

echo "=== RUN A: enforcer alone (goal OFF) ==="
TRACE_A="$(run_case "todo-only" false \
  'Call todowrite with exactly one todo: content "count to three", status "pending", priority "medium". Then reply DONE and stop.')"

grep 'omo\.todo\.' "$TRACE_A" > "$OUT/todo-events-a.ndjson" 2>/dev/null || : > "$OUT/todo-events-a.ndjson"

# Anti-vacuity guard. A plugin that never loads emits no events, and every
# "no bad thing happened" check below would pass for the wrong reason.
TOTAL_A="$(wc -l < "$TRACE_A" 2>/dev/null | tr -d ' ')"
[ "${TOTAL_A:-0}" -gt 0 ] && L=1 || L=0
check "a-plugin-loaded" "$L" "trace is non-empty, so the plugin actually ran (lines=$TOTAL_A)"

REG_A="$(events "$TRACE_A" "omo.todo.registered")"
[ "$REG_A" -ge 1 ] && R=1 || R=0
check "a-registered" "$R" "enforcer registered with the shared gate wired (reg=$REG_A)"

INJ_A="$(events "$TRACE_A" "omo.todo.continuation-injected")"
ERR_A="$(events "$TRACE_A" "omo.todo.event-error")"
echo "  [todo-only] injected=$INJ_A event-error=$ERR_A"
# The positive direction: it must actually fire, exactly once for one edge.
[ "$INJ_A" -eq 1 ] && [ "$ERR_A" -eq 0 ] && N=1 || N=0
check "a-enforcer-fires" "$N" "unfinished todo produced exactly one continuation (inj=$INJ_A)"

echo "=== RUN B: goal ON + enforcer ON, one idle edge ==="
TRACE_B="$(run_case "both" true \
  'Call create_goal with objective "count to three". Then call todowrite with exactly one todo: content "count to three", status "pending", priority "medium". Then reply DONE and stop.')"

grep -E 'omo\.(todo|goal)\.' "$TRACE_B" > "$OUT/todo-events-b.ndjson" 2>/dev/null || : > "$OUT/todo-events-b.ndjson"

TOTAL_B="$(wc -l < "$TRACE_B" 2>/dev/null | tr -d ' ')"
[ "${TOTAL_B:-0}" -gt 0 ] && L=1 || L=0
check "b-plugin-loaded" "$L" "trace is non-empty, so the plugin actually ran (lines=$TOTAL_B)"

REG_G="$(events "$TRACE_B" "omo.goal.registered")"
REG_T="$(events "$TRACE_B" "omo.todo.registered")"
[ "$REG_G" -ge 1 ] && [ "$REG_T" -ge 1 ] && R=1 || R=0
check "b-both-armed" "$R" "both injectors registered, so contention is real (goal=$REG_G todo=$REG_T)"

INJ_G="$(events "$TRACE_B" "omo.goal.continuation-injected")"
INJ_T="$(events "$TRACE_B" "omo.todo.continuation-injected")"
SUM=$((INJ_G + INJ_T))
echo "  [both] goal-injected=$INJ_G todo-injected=$INJ_T sum=$SUM"
# The property PR-5 exists to prove. Two instances of the gate would let both
# fire, giving sum=2 and a double injection into one turn.
[ "$SUM" -le 1 ] && C=1 || C=0
check "b-single-dispatch" "$C" "the two injectors produced at most one injection between them (sum=$SUM)"

ERRS="$(events "$TRACE_B" "omo.todo.event-error")"
ERRG="$(events "$TRACE_B" "omo.goal.event-error")"
[ "$ERRS" -eq 0 ] && [ "$ERRG" -eq 0 ] && P=1 || P=0
check "b-no-pump-error" "$P" "no error escaped either event pump (todo=$ERRS goal=$ERRG)"

AFTER="$(host_count)"
[ "$BEFORE" = "$AFTER" ] && I=1 || I=0
check "isolation" "$I" "host opencode.db unchanged ($BEFORE -> $AFTER)"

tail -n 40 "$TRACE_B" > "$OUT/trace-tail.ndjson" 2>/dev/null || :

echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
