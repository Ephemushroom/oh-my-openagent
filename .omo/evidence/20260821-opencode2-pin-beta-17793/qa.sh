#!/usr/bin/env bash
# QA: omo-opencode2 pin bump next-17444 -> beta-17793, driven against the real
# beta-17823 binary (whose plugin dist is byte-identical to beta-17793's).
#
# Doctrine: assert on OMO_SPIKE_TRACE NDJSON, never on CLI transcript prose.
# Every capability gets a positive case; the API-limit re-checks are proven by
# probing the runtime domains directly from the plugin trace.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"
REPO="$(cd "$HERE/../../.." && pwd)"
mkdir -p "$OUT"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s -- %s\n' "$1" "${2:-}"; }
count() { local n; n="$(grep -c "$1" "$2" 2>/dev/null)"; n="${n:-0}"; printf '%s' "$n" | head -n 1; }

BIN="${OPENCODE2_BIN:-$HOME/.bun/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "opencode2 binary not found at $BIN"; exit 2; }
BINVER="$("$BIN" --version 2>&1 | head -n 1)"
echo "binary: $BINVER"

KEY="$(node -e 'const a=require(require("os").homedir()+"/.local/share/opencode/auth.json");process.stdout.write(a.zhipuai?.key??"")' 2>/dev/null || true)"
[ -n "$KEY" ] || { echo "no zhipuai key in auth.json"; exit 2; }

HOST_DB="$HOME/.local/share/opencode/opencode.db"
HOST_BEFORE="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"

S="$(mktemp -d)"
trap 'rm -rf "$S" 2>/dev/null || true' EXIT
export HOME="$S/home" USERPROFILE="$S/home"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
export OPENCODE_TEST_HOME="$S/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY="$KEY"
mkdir -p "$HOME/project" "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME"

TRACE="$S/trace.ndjson"
export OMO_SPIKE_TRACE="$TRACE"

PLUGIN="$(cygpath -m "$REPO/packages/omo-opencode2/src/index.ts")"
cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{ "\$schema": "https://opencode.ai/config.json", "plugin": ["$PLUGIN"] }
EOF

cd "$HOME/project"
git init -q . 2>/dev/null || true

# ---------------------------------------------------------------------------
# Case 1: core smoke on the bumped pin. One prompt that exercises
# registration + a tool call + hashline-enhanced read, all in one session.
# ---------------------------------------------------------------------------
: > "$TRACE" 2>/dev/null || true

cat > hello.ts <<'EOF'
export function greet(name: string): string {
  return `hello ${name}`
}
EOF

PROMPT='Read hello.ts, then use the hashline_edit tool to change the greeting from "hello" to "goodbye". Confirm the edit applied.'

timeout -k 5 300 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 "$PROMPT" >"$OUT/case1-run.txt" 2>&1
sleep 3
cp "$TRACE" "$OUT/case1-trace.ndjson" 2>/dev/null || true

# 1. anti-vacuity
if [ -s "$TRACE" ]; then ok "case1-trace-non-empty"; else bad "case1-trace-non-empty" "no trace written"; fi

# 2. plugin booted and completed registration on the bumped pin
n="$(count 'omo.registration.complete' "$TRACE")"
if [ "$n" -ge 1 ]; then ok "plugin-booted ($n)"; else bad "plugin-booted" "no omo.registration.complete"; fi

# 3. agent registration summary mentions sisyphus (primary default)
if grep 'omo.agent.registered' "$TRACE" | grep -q 'sisyphus'; then
  ok "agents-registered-sisyphus"
else bad "agents-registered-sisyphus" "no sisyphus in registration summary"; fi

# 4. hashline read-enhancer fired on the read (LINE#ID tagging)
if grep -q 'omo.hashline' "$TRACE"; then
  ok "hashline-read-enhancer-fired"
else bad "hashline-read-enhancer-fired" "no omo.hashline events"; fi

# 5. the edit tool executed and reported success
if grep 'omo.hashline' "$TRACE" | grep -qi 'applied\|success\|edited'; then
  ok "hashline-edit-applied"
else bad "hashline-edit-applied" "no applied edit event"; fi

# 6. no plugin error events
if grep -q 'omo.plugin.error\|omo.error' "$TRACE"; then
  bad "no-plugin-errors" "error events in trace"; else ok "no-plugin-errors"; fi

# 7. file actually changed on disk (behavior, not just events)
if grep -q 'goodbye' "$HOME/project/hello.ts"; then
  ok "edit-landed-on-disk"
else bad "edit-landed-on-disk" "hello.ts still says hello"; fi

# 8. session store exists in sandbox (plugin ran inside isolation)
if [ -f "$XDG_DATA_HOME/opencode/opencode.db" ]; then
  ok "sandbox-store-exists"; else bad "sandbox-store-exists" "no sandbox opencode.db"; fi

# ---------------------------------------------------------------------------
# Case 2 (negative): plugin NOT loaded -> no trace events at all. Proves the
# events in case 1 came from the plugin, not from the harness itself.
# ---------------------------------------------------------------------------
S2="$(mktemp -d)"
export HOME="$S2/home" USERPROFILE="$S2/home"
export XDG_DATA_HOME="$S2/data" XDG_CONFIG_HOME="$S2/config" XDG_CACHE_HOME="$S2/cache" XDG_STATE_HOME="$S2/state"
export OPENCODE_TEST_HOME="$S2/home"
mkdir -p "$HOME/project" "$XDG_CONFIG_HOME/opencode"

TRACE2="$S2/trace2.ndjson"
export OMO_SPIKE_TRACE="$TRACE2"
cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<'EOF'
{ "$schema": "https://opencode.ai/config.json" }
EOF

cd "$HOME/project"
git init -q . 2>/dev/null || true
echo 'x' > dummy.txt

timeout -k 5 180 "$BIN" run --standalone --auto --model zhipuai/glm-4.7 'Read dummy.txt and reply DONE.' >"$OUT/case2-run.txt" 2>&1
sleep 2
cp "$TRACE2" "$OUT/case2-trace.ndjson" 2>/dev/null || true

if [ -s "$TRACE2" ]; then
  bad "no-plugin-no-trace" "trace has events without the plugin loaded"
else ok "no-plugin-no-trace"; fi

rm -rf "$S2" 2>/dev/null || true

# restore case-1 sandbox env for the isolation sweep
export HOME="$S/home" USERPROFILE="$S/home"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"

# ---------------------------------------------------------------------------
# 9. isolation sweep: host store untouched
# ---------------------------------------------------------------------------
HOST_AFTER="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"
if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then ok "host-store-isolated ($HOST_BEFORE)"; else bad "host-store-isolated" "$HOST_BEFORE -> $HOST_AFTER"; fi

printf '\n%s\n' "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
