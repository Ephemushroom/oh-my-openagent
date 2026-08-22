#!/usr/bin/env bash
# QA: opencode2 BTW side conversations (btw_start/btw_reply/btw_list + tool
# guard), driven against the real opencode2 binary in an isolated sandbox.
#
# Doctrine: assert on OMO_SPIKE_TRACE NDJSON, never CLI transcript prose.
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

# btw is default OFF; enable it. Adapter keys live under "[opencode2]".
mkdir -p "$HOME/project/.omo"
cat > "$HOME/project/.omo/omo.json" <<'EOF'
{ "[opencode2]": { "btw": { "enabled": true } } }
EOF

cd "$HOME/project"
git init -q . 2>/dev/null || true
echo 'alpha note: the cache key isfruit' > notes.txt

# ---------------------------------------------------------------------------
# Case 1 (positive): main session runs, uses btw_start for a side question.
# The side conversation must be created, prompted with parent context + the
# omo_btw metadata, and answer back through the waiter pump.
# ---------------------------------------------------------------------------
: > "$TRACE" 2>/dev/null || true

PROMPT='First read notes.txt. Then call btw_start with the question "what word did the note say the cache key is?". Report the BTW answer verbatim in your reply, prefixed with BTWANSWER:.'

timeout -k 5 300 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 "$PROMPT" >"$OUT/case1-run.txt" 2>&1
sleep 3
cp "$TRACE" "$OUT/case1-trace.ndjson" 2>/dev/null || true

# 1. anti-vacuity
if [ -s "$TRACE" ]; then ok "case1-trace-non-empty"; else bad "case1-trace-non-empty" "no trace"; fi

# 2. btw registered (config gate opened)
if grep -q 'omo.btw.registered' "$TRACE"; then ok "btw-registered"; else bad "btw-registered" "no omo.btw.registered"; fi

# 3. a side conversation started
n="$(count 'omo.btw.started' "$TRACE")"
if [ "$n" -ge 1 ]; then ok "btw-started ($n)"; else bad "btw-started" "no omo.btw.started"; fi

# 4. the side conversation finished (waiter pump resolved)
n="$(count 'omo.btw.finished' "$TRACE")"
if [ "$n" -ge 1 ]; then ok "btw-finished ($n)"; else bad "btw-finished" "no omo.btw.finished"; fi

# 5. side session exists in the sandbox store with the BTW title
DB="$XDG_DATA_HOME/opencode/opencode.db"
TITLE_HIT="$(sqlite3 "$DB" "select count(*) from session_v2 where title like 'BTW%'" 2>/dev/null || echo 0)"
if [ "$TITLE_HIT" -ge 1 ]; then ok "side-session-in-store ($TITLE_HIT)"; else bad "side-session-in-store" "no BTW-titled session"; fi

# 6. the side session's user message carries the omo_btw metadata + parent context
META_HIT="$(sqlite3 "$DB" "select count(*) from session_message where data like '%omo_btw%'" 2>/dev/null || echo 0)"
if [ "$META_HIT" -ge 1 ]; then ok "btw-metadata-in-message ($META_HIT)"; else bad "btw-metadata-in-message" "no omo_btw in any message"; fi

CTX_HIT="$(sqlite3 "$DB" "select count(*) from session_message where data like '%omo-btw-side%' or data like '%omo-btw-parent-context%'" 2>/dev/null || echo 0)"
if [ "$CTX_HIT" -ge 1 ]; then ok "boundary-injected"; else bad "boundary-injected" "no boundary/parent-context text in messages"; fi

# 7. the model reported the side answer (behavioral proof)
if grep -q 'BTWANSWER' "$OUT/case1-run.txt"; then
  ok "answer-reported"
else bad "answer-reported" "no BTWANSWER prefix in transcript"; fi

# 8. isolation: host store untouched
HOST_AFTER="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"
if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then ok "host-store-isolated ($HOST_BEFORE)"; else bad "host-store-isolated" "$HOST_BEFORE -> $HOST_AFTER"; fi

# ---------------------------------------------------------------------------
# Case 2 (negative): btw disabled -> tools absent, no btw trace events.
# ---------------------------------------------------------------------------
S2="$(mktemp -d)"
export HOME="$S2/home" USERPROFILE="$S2/home"
export XDG_DATA_HOME="$S2/data" XDG_CONFIG_HOME="$S2/config" XDG_CACHE_HOME="$S2/cache" XDG_STATE_HOME="$S2/state"
export OPENCODE_TEST_HOME="$S2/home"
mkdir -p "$HOME/project" "$XDG_CONFIG_HOME/opencode"

TRACE2="$S2/trace2.ndjson"
export OMO_SPIKE_TRACE="$TRACE2"
cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{ "\$schema": "https://opencode.ai/config.json", "plugin": ["$PLUGIN"] }
EOF

cd "$HOME/project"
git init -q . 2>/dev/null || true
echo 'x' > dummy.txt

timeout -k 5 240 "$BIN" run --standalone --auto --model zhipuai/glm-4.7 'Read dummy.txt and reply DONE.' >"$OUT/case2-run.txt" 2>&1
sleep 2
cp "$TRACE2" "$OUT/case2-trace.ndjson" 2>/dev/null || true

if grep -q 'omo.btw.disabled' "$TRACE2"; then
  ok "btw-disabled-by-default"
elif grep -q 'omo.btw.registered' "$TRACE2"; then
  bad "btw-disabled-by-default" "btw registered without config"
else
  bad "btw-disabled-by-default" "neither disabled nor registered event"
fi

rm -rf "$S2" 2>/dev/null || true

printf '\n%s\n' "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
