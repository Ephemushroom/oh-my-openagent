#!/usr/bin/env bash
# QA for the upstream beta.9 sync: prove the opencode2 adapter still boots,
# registers its full surface, and drives a real session after the merge.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/out"; mkdir -p "$OUT"
BIN="${OPENCODE2_BIN:-$HOME/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "FATAL: no binary"; exit 1; }
KEY="$(node -e 'try{const a=require(process.env.HOME+"/.local/share/opencode/auth.json");process.stdout.write(a.zhipuai?.key||"")}catch{}')"
[ -n "$KEY" ] || { echo "FATAL: no key"; exit 1; }
HOST_DB="$(cygpath -u "$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')" 2>/dev/null || true)/.local/share/opencode/opencode.db"
host_count() { [ -f "$HOST_DB" ] && stat -c %s "$HOST_DB" 2>/dev/null || echo "absent"; }
BEFORE="$(host_count)"
S="$(mktemp -d)"
export HOME="$S/home" USERPROFILE="$S/home"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
export OPENCODE_TEST_HOME="$S/home" OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 ZHIPU_API_KEY="$KEY"
PROJ="$S/home/project"; mkdir -p "$PROJ/.omo" "$XDG_CONFIG_HOME/opencode"
PLUGIN="$(cygpath -m "$(cd "$REPO/packages/omo-opencode2" && pwd)")/src/index.ts"
cat > "$PROJ/opencode.jsonc" <<EOF
{ "plugins": ["$PLUGIN"] }
EOF
# All three injectors armed, so the QA also re-proves the shared gate survived
# the merge (the merge touched packages they depend on).
cat > "$PROJ/.omo/omo.json" <<'EOF'
{
  "[opencode2]": {
    "goal": { "enabled": true },
    "todo_continuation": { "enabled": true, "max_consecutive": 2 },
    "boulder": { "enabled": true },
    "agents": { "sisyphus": { "model": "zhipuai/glm-4.7" } }
  }
}
EOF
export OMO_SPIKE_TRACE="$S/trace.ndjson"; : > "$OMO_SPIKE_TRACE"
cd "$PROJ" || exit 1
timeout 180 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 'Reply DONE and stop.' > "$OUT/run.txt" 2>&1
echo "run exit: $?"

PASS=0; FAIL=0
check() { if [ "$2" = "1" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
events() { local n; n="$(grep -c "\"event\":\"$2\"" "$1" 2>/dev/null)" || n=0; printf '%s' "$n"; }

# Anti-vacuity: the plugin must have traced at all.
TOTAL="$(wc -l < "$OMO_SPIKE_TRACE" 2>/dev/null | tr -d ' ')"
[ "${TOTAL:-0}" -gt 0 ] && L=1 || L=0
check "plugin-loaded" "$L" "trace non-empty after merge (lines=$TOTAL)"

# Registration surface survived the merge.
ORCH="$(events "$OMO_SPIKE_TRACE" "omo.orchestration.registered")"
GUARDS="$(events "$OMO_SPIKE_TRACE" "omo.tool-guards.registered")"
CTX="$(events "$OMO_SPIKE_TRACE" "omo.context-hooks.registered")"
[ "$ORCH" -ge 1 ] && [ "$GUARDS" -ge 1 ] && [ "$CTX" -ge 1 ] && R=1 || R=0
check "surface-registered" "$R" "orchestration=$ORCH guards=$GUARDS context=$CTX"

# The shared gate and its three injectors re-registered after the sync touched
# model-core / agents-core / shared-skills underneath them.
GOAL="$(events "$OMO_SPIKE_TRACE" "omo.goal.registered")"
TODO="$(events "$OMO_SPIKE_TRACE" "omo.todo.registered")"
BOULDER="$(events "$OMO_SPIKE_TRACE" "omo.boulder.registered")"
[ "$GOAL" -ge 1 ] && [ "$TODO" -ge 1 ] && [ "$BOULDER" -ge 1 ] && G=1 || G=0
check "gate-injectors-armed" "$G" "goal=$GOAL todo=$TODO boulder=$BOULDER"

# The session actually ran end to end. Assert on the trace's execution
# lifecycle, not CLI prose. Native session events carry the name in `type`
# (`"event":"event","type":"session.execution.succeeded"`), unlike omo.*
# events which carry it in `event`, so match `type` here.
SUCC="$(grep -c '"type":"session.execution.succeeded"' "$OMO_SPIKE_TRACE" 2>/dev/null)"; SUCC="${SUCC:-0}"
FAILED="$(grep -c '"type":"session.execution.failed"' "$OMO_SPIKE_TRACE" 2>/dev/null)"; FAILED="${FAILED:-0}"
SUCC="$(printf '%s' "$SUCC" | head -n 1)"; FAILED="$(printf '%s' "$FAILED" | head -n 1)"
[ "$SUCC" -ge 1 ] && [ "$FAILED" -eq 0 ] && D=1 || D=0
check "session-completed" "$D" "execution.succeeded=$SUCC execution.failed=$FAILED"

# No injector errored inside its pump.
ERRS="$(grep -c 'event-error' "$OMO_SPIKE_TRACE" 2>/dev/null)"; ERRS="${ERRS:-0}"
ERRS="$(printf '%s' "$ERRS" | head -n 1)"
[ "$ERRS" -eq 0 ] && E=1 || E=0
check "no-pump-error" "$E" "event-error count=$ERRS"

AFTER="$(host_count)"
[ "$BEFORE" = "$AFTER" ] && I=1 || I=0
check "isolation" "$I" "host opencode.db unchanged ($BEFORE -> $AFTER)"

tail -n 30 "$OMO_SPIKE_TRACE" > "$OUT/trace-tail.ndjson" 2>/dev/null || :
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
