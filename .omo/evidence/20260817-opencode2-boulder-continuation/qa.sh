#!/usr/bin/env bash
# QA for the boulder (start-work) continuation enforcer (packages/omo-opencode2).
#
# Proves against the REAL opencode2 binary, in an isolated sandbox:
#   RUN A (boulder ON, goal+todo OFF): a session owning a real, seeded
#     .omo/boulder.json with an incomplete plan injects EXACTLY ONE continuation
#     on its idle edge. This is the positive direction and it proves the whole
#     file pipeline end to end: boulder.json -> resolve plan path -> parse
#     checklist -> inject.
#   RUN B (boulder + goal + todo all ON): three independent idle injectors
#     observing the SAME idle edge produce AT MOST ONE injection between them.
#   Both runs: the host opencode stores are untouched.
#
# The boulder state is seeded by calling the real @oh-my-opencode/boulder-state
# writer from bun, so the file is byte-for-byte what the reader consumes. The
# session id is learned by a probe run first: the context hook records it on
# omo.context.agents, and a follow-up run in the same project reuses that
# session, so the work is seeded between the two with the real id.
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

seed_boulder() {
  local proj_m="$1" sid="$2"
  ( cd "$REPO" && bun -e '
import { createBoulderState, writeBoulderState } from "@oh-my-opencode/boulder-state"
const dir = process.argv[1]
writeBoulderState(dir, createBoulderState(`${dir}/.omo/plans/plan.md`, process.argv[2]))
' "$proj_m" "$sid" >/dev/null 2>&1 )
}

# $1 = label, $2 = config JSON, $3 = prompt, $4 = "seed" to seed a boulder work
# to the session id captured by a probe turn first. Echoes the trace path.
run_case() {
  local label="$1" config_json="$2" prompt="$3" mode="${4:-}"
  local S; S="$(mktemp -d)"
  export HOME="$S/home" USERPROFILE="$S/home"
  export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config"
  export XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
  export OPENCODE_TEST_HOME="$S/home"
  export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
  export ZHIPU_API_KEY="$KEY"
  local PROJ="$S/home/project"
  mkdir -p "$PROJ/.omo/plans" "$XDG_CONFIG_HOME/opencode"

  local PLUGIN; PLUGIN="$(cygpath -m "$(cd "$REPO/packages/omo-opencode2" && pwd)")/src/index.ts"
  cat > "$PROJ/opencode.jsonc" <<EOF
{ "plugins": ["$PLUGIN"] }
EOF
  cat > "$PROJ/.omo/omo.json" <<EOF
{ "[opencode2]": $config_json }
EOF
  cat > "$PROJ/.omo/plans/plan.md" <<'EOF'
# Plan

## TODOs
- [ ] 1. first task
- [ ] 2. second task
- [x] 3. done task
EOF

  export OMO_SPIKE_TRACE="$S/trace.ndjson"; : > "$OMO_SPIKE_TRACE"
  cd "$PROJ" || return 1
  local PROJ_M; PROJ_M="$(cygpath -m "$PROJ")"

  if [ "$mode" = "seed" ]; then
    # Probe turn to learn the session id, then seed the work bound to it.
    timeout 90 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 \
      'Reply DONE and stop.' > "$OUT/probe-$label.txt" 2>&1
    local sid; sid="$(grep -o '"sessionID":"[^"]*"' "$OMO_SPIKE_TRACE" 2>/dev/null | head -n 1 | sed 's/.*:"//; s/"//')"
    [ -n "$sid" ] && seed_boulder "$PROJ_M" "$sid"
    : > "$OMO_SPIKE_TRACE"
  fi

  timeout 180 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 \
    "$prompt" > "$OUT/run-$label.txt" 2>&1
  echo "  [$label] run exit: $?" >&2
  cp "$OMO_SPIKE_TRACE" "$S/keep.ndjson" >&2
  printf '%s' "$S/keep.ndjson"
}

CFG_BOULDER='{ "boulder": { "enabled": true }, "agents": { "sisyphus": { "model": "zhipuai/glm-4.7" } } }'
CFG_ALL='{ "boulder": { "enabled": true }, "goal": { "enabled": true }, "todo_continuation": { "enabled": true, "max_consecutive": 2 }, "agents": { "sisyphus": { "model": "zhipuai/glm-4.7" } } }'

echo "=== RUN A: boulder ON, goal+todo OFF, seeded work ==="
TRACE_A="$(run_case "boulder-only" "$CFG_BOULDER" 'Reply DONE and stop.' "seed")"

grep 'omo\.boulder\.' "$TRACE_A" > "$OUT/boulder-events-a.ndjson" 2>/dev/null || : > "$OUT/boulder-events-a.ndjson"

TOTAL_A="$(wc -l < "$TRACE_A" 2>/dev/null | tr -d ' ')"
[ "${TOTAL_A:-0}" -gt 0 ] && L=1 || L=0
check "a-plugin-loaded" "$L" "trace is non-empty, so the plugin actually ran (lines=$TOTAL_A)"

REG_A="$(events "$TRACE_A" "omo.boulder.registered")"
[ "$REG_A" -ge 1 ] && R=1 || R=0
check "a-registered" "$R" "boulder enforcer registered with the shared gate wired (reg=$REG_A)"

INJ_A="$(events "$TRACE_A" "omo.boulder.continuation-injected")"
ERR_A="$(events "$TRACE_A" "omo.boulder.event-error")"
echo "  [boulder-only] injected=$INJ_A event-error=$ERR_A"
# Positive direction: the whole file pipeline must fire, exactly once.
[ "$INJ_A" -eq 1 ] && [ "$ERR_A" -eq 0 ] && N=1 || N=0
check "a-enforcer-fires" "$N" "seeded incomplete plan produced exactly one continuation (inj=$INJ_A)"

echo "=== RUN B: boulder + goal + todo all ON, seeded work, one idle edge ==="
TRACE_B="$(run_case "all" "$CFG_ALL" 'Reply DONE and stop.' "seed")"

grep -E 'omo\.(boulder|todo|goal)\.' "$TRACE_B" > "$OUT/boulder-events-b.ndjson" 2>/dev/null || : > "$OUT/boulder-events-b.ndjson"

TOTAL_B="$(wc -l < "$TRACE_B" 2>/dev/null | tr -d ' ')"
[ "${TOTAL_B:-0}" -gt 0 ] && L=1 || L=0
check "b-plugin-loaded" "$L" "trace is non-empty, so the plugin actually ran (lines=$TOTAL_B)"

REG_G="$(events "$TRACE_B" "omo.goal.registered")"
REG_T="$(events "$TRACE_B" "omo.todo.registered")"
REG_B="$(events "$TRACE_B" "omo.boulder.registered")"
[ "$REG_G" -ge 1 ] && [ "$REG_T" -ge 1 ] && [ "$REG_B" -ge 1 ] && R=1 || R=0
check "b-all-armed" "$R" "all three injectors registered, so contention is real (goal=$REG_G todo=$REG_T boulder=$REG_B)"

INJ_G="$(events "$TRACE_B" "omo.goal.continuation-injected")"
INJ_T="$(events "$TRACE_B" "omo.todo.continuation-injected")"
INJ_B="$(events "$TRACE_B" "omo.boulder.continuation-injected")"
SUM=$((INJ_G + INJ_T + INJ_B))
echo "  [all] goal=$INJ_G todo=$INJ_T boulder=$INJ_B sum=$SUM"
[ "$SUM" -le 1 ] && C=1 || C=0
check "b-single-dispatch" "$C" "three injectors produced at most one injection between them (sum=$SUM)"

ERRS="$(events "$TRACE_B" "omo.todo.event-error")"
ERRG="$(events "$TRACE_B" "omo.goal.event-error")"
ERRB="$(events "$TRACE_B" "omo.boulder.event-error")"
[ "$ERRS" -eq 0 ] && [ "$ERRG" -eq 0 ] && [ "$ERRB" -eq 0 ] && P=1 || P=0
check "b-no-pump-error" "$P" "no error escaped any event pump (todo=$ERRS goal=$ERRG boulder=$ERRB)"

AFTER="$(host_count)"
[ "$BEFORE" = "$AFTER" ] && I=1 || I=0
check "isolation" "$I" "host opencode.db unchanged ($BEFORE -> $AFTER)"

tail -n 40 "$TRACE_B" > "$OUT/trace-tail.ndjson" 2>/dev/null || :

echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
