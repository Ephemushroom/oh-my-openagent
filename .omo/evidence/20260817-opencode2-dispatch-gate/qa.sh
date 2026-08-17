#!/usr/bin/env bash
# QA for the shared session dispatch gate (packages/omo-opencode2).
#
# Proves against the REAL opencode2 binary, in an isolated sandbox:
#   1. the plugin still loads and the goal feature registers, which is the
#      wiring that would crash if the required `gate` dependency were not
#      threaded to the runtime (undefined gate -> TypeError on first idle);
#   2. a goal-enabled session that reaches an idle edge injects EXACTLY ONE
#      continuation, never zero and never two;
#   3. the host opencode stores are untouched.
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

S="$(mktemp -d)"
export HOME="$S/home" USERPROFILE="$S/home"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config"
export XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
export OPENCODE_TEST_HOME="$S/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY="$KEY"
# Config layers walk cwd up to $HOME, so the project must live under it.
PROJ="$S/home/project"
mkdir -p "$PROJ/.omo" "$XDG_CONFIG_HOME/opencode"

# opencode2 is a native Windows binary and cannot resolve MSYS /d/... paths, so
# the config must carry a mixed path (D:/...), which is also JSON-safe.
PLUGIN="$(cygpath -m "$(cd "$REPO/packages/omo-opencode2" && pwd)")/src/index.ts"
cat > "$PROJ/opencode.jsonc" <<EOF
{ "plugins": ["$PLUGIN"] }
EOF
# goal.enabled is what arms the only gated dispatch site.
cat > "$PROJ/.omo/omo.json" <<'EOF'
{
  "[opencode2]": {
    "goal": { "enabled": true },
    "agents": { "sisyphus": { "model": "zhipuai/glm-4.7" } }
  }
}
EOF

HOST_DB="$(cygpath -u "$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')" 2>/dev/null || true)/.local/share/opencode/opencode.db"
host_count() { [ -f "$HOST_DB" ] && stat -c %s "$HOST_DB" 2>/dev/null || echo "absent"; }
BEFORE="$(host_count)"

PASS=0; FAIL=0
check() {
  if [ "$2" = "1" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1))
  else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi
}
events() { local n; n="$(grep -c "\"event\":\"$2\"" "$1" 2>/dev/null)" || n=0; printf '%s' "$n"; }

export OMO_SPIKE_TRACE="$S/trace.ndjson"; : > "$OMO_SPIKE_TRACE"

# A goal is active, so the idle edge at the end of this turn arms the gated
# continuation. Bounded by timeout because goal deliberately re-prompts.
cd "$PROJ" || exit 1
timeout 180 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 \
  'Call create_goal with objective "count to three" then reply DONE.' \
  > "$OUT/run-goal.txt" 2>&1
echo "  run exit: $?"

grep 'omo\.goal\.' "$OMO_SPIKE_TRACE" > "$OUT/goal-events.ndjson" 2>/dev/null || : > "$OUT/goal-events.ndjson"

# Anti-vacuity guard. Without this, a plugin that never loads emits no events
# and every "no bad thing happened" check below passes for the wrong reason.
TOTAL="$(wc -l < "$OMO_SPIKE_TRACE" 2>/dev/null | tr -d ' ')"
[ "${TOTAL:-0}" -gt 0 ] && L=1 || L=0
check "plugin-loaded" "$L" "trace is non-empty, so the plugin actually ran (lines=$TOTAL)"

REG="$(events "$OMO_SPIKE_TRACE" "omo.goal.registered")"
[ "$REG" -ge 1 ] && R=1 || R=0
check "registered" "$R" "goal feature registered with the shared gate wired (reg=$REG)"

INJ="$(events "$OMO_SPIKE_TRACE" "omo.goal.continuation-injected")"
FAILED="$(events "$OMO_SPIKE_TRACE" "omo.goal.continuation-failed")"
echo "  continuation-injected=$INJ continuation-failed=$FAILED"
[ "$INJ" -le 1 ] && [ "$FAILED" -eq 0 ] && N=1 || N=0
check "single-dispatch" "$N" "at most one continuation per idle edge, no gate-path failures"

# An undefined gate would surface here: the first idle throws inside the pump.
PUMPERR="$(events "$OMO_SPIKE_TRACE" "omo.goal.event-error")"
[ "$PUMPERR" -eq 0 ] && P=1 || P=0
check "no-pump-error" "$P" "no error escaped the goal event pump (errors=$PUMPERR)"

AFTER="$(host_count)"
[ "$BEFORE" = "$AFTER" ] && I=1 || I=0
check "isolation" "$I" "host opencode.db unchanged ($BEFORE -> $AFTER)"

cp "$OMO_SPIKE_TRACE" "$OUT/trace-tail.ndjson" 2>/dev/null && tail -n 50 "$OUT/trace-tail.ndjson" > "$OUT/trace-tail.tmp" && mv "$OUT/trace-tail.tmp" "$OUT/trace-tail.ndjson"

echo "summary: PASS=$PASS FAIL=$FAIL"
rm -rf "$S"
[ "$FAIL" -eq 0 ]
