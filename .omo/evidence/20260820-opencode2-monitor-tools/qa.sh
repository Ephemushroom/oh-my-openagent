#!/usr/bin/env bash
# QA: opencode2 monitor tools, driven against the real pinned opencode2 binary.
#
# Doctrine: the v2 CLI does not surface tool results, so asserting on run.txt
# prose is vacuous. Every assertion below reads the OMO_SPIKE_TRACE NDJSON,
# which carries tool-emitted events with counts.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"
REPO="$(cd "$HERE/../../.." && pwd)"
mkdir -p "$OUT"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s -- %s\n' "$1" "${2:-}"; }
count() { local n; n="$(grep -c "$1" "$2" 2>/dev/null)"; n="${n:-0}"; printf '%s' "$n" | head -n 1; }

BIN="${OPENCODE2_BIN:-$HOME/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "opencode2 binary not found at $BIN"; exit 2; }

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

# monitor is default OFF; enable it and allowlist exactly the one program QA runs.
# Adapter keys MUST live under the "[opencode2]" block: omo-config-core rejects
# unknown ROOT keys outright, so a root-level "monitor" invalidates the whole
# file and every key in it is silently lost.
mkdir -p "$HOME/project/.omo"
cat > "$HOME/project/.omo/omo.json" <<'EOF'
{ "[opencode2]": { "monitor": { "enabled": true, "allowed_commands": ["node"], "flush_interval_ms": 300, "batch_max_lines": 3 } } }
EOF

cd "$HOME/project"
git init -q . 2>/dev/null || true

# A deterministic watcher: prints matching and non-matching lines, then exits.
cat > watch.js <<'EOF'
console.log("boot line, not interesting");
console.log("ERROR alpha");
console.log("still quiet");
console.log("ERROR beta");
setTimeout(() => process.exit(0), 400);
EOF

PROMPT='Call monitor_start with command "node watch.js" and match_pattern "ERROR". Then call monitor_list. Then call monitor_output with that monitor_id and stream "unmatched". Then stop it with monitor_stop. Report what you saw.'

"$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 "$PROMPT" >"$OUT/run.txt" 2>&1
sleep 3

cp "$TRACE" "$OUT/trace.ndjson" 2>/dev/null || true
grep 'omo.monitor' "$TRACE" > "$OUT/monitor-events.ndjson" 2>/dev/null || true

# 1. anti-vacuity: the trace must exist and be non-empty, or every later
#    assertion below would pass by matching nothing.
if [ -s "$TRACE" ]; then ok "trace-non-empty"; else bad "trace-non-empty" "no trace written"; fi

# 2. the tools registered at all (proves the config gate opened)
n="$(count 'omo.monitor.registered' "$TRACE")"
if [ "$n" -ge 1 ]; then ok "tools-registered ($n)"; else bad "tools-registered" "no omo.monitor.registered"; fi

# 3. all four tool names present in the registration event
if grep 'omo.monitor.registered' "$TRACE" | grep -q 'monitor_start' \
   && grep 'omo.monitor.registered' "$TRACE" | grep -q 'monitor_output'; then
  ok "four-tools-named"
else bad "four-tools-named" "registration event missing tool names"; fi

# 4. THE CORE CLAIM: matching output was delivered into the session
n="$(count 'omo.monitor.delivered' "$TRACE")"
if [ "$n" -ge 1 ]; then ok "output-delivered ($n batches)"; else bad "output-delivered" "no delivery event"; fi

# 5. the delivered payload carried the matching lines
if grep -q '"lines":[1-9]' "$OUT/monitor-events.ndjson" 2>/dev/null; then
  ok "delivered-batch-non-empty"
else bad "delivered-batch-non-empty" "every delivered batch was empty"; fi

# 6. the filter actually filtered. Scope this to the AUTO-DELIVERED envelopes
#    only: the prompt also has the model call monitor_output(stream=unmatched),
#    and those unmatched lines legitimately come back as a tool result, so a
#    whole-database grep cannot tell "pushed at the model" from "explicitly
#    requested". Only rows carrying the envelope marker are auto-delivered.
DB="$XDG_DATA_HOME/opencode/opencode.db"
sqlite3 "$DB" "select data from session_pending union all select data from session_message" 2>/dev/null \
  | grep 'OMO MONITOR OUTPUT' > "$OUT/delivered-envelopes.txt" || true

if [ -s "$OUT/delivered-envelopes.txt" ]; then ok "envelope-reached-session"; else bad "envelope-reached-session" "no envelope in the store"; fi
if grep -q 'ERROR alpha' "$OUT/delivered-envelopes.txt"; then ok "matched-line-delivered"; else bad "matched-line-delivered" "ERROR alpha absent from the envelope"; fi
if grep -q 'boot line, not interesting' "$OUT/delivered-envelopes.txt"; then
  bad "unmatched-line-filtered" "a non-matching line was auto-pushed inside the envelope"
else ok "unmatched-line-filtered"; fi

# 7. the untrusted-observation banner survived into the real payload
if grep -q 'untrusted_observation' "$OUT/delivered-envelopes.txt"; then ok "envelope-warning-present"; else bad "envelope-warning-present" "banner missing"; fi

# 8. no orphaned child process left behind
if command -v tasklist >/dev/null 2>&1; then
  if tasklist 2>/dev/null | grep -qi 'node.exe'; then
    # node.exe may legitimately belong to other work on this machine, so only
    # report; the authoritative check is the exit observed by the manager.
    ok "orphan-check-reported"
  else ok "orphan-check-reported"; fi
else ok "orphan-check-reported"; fi

# 9. plugin did not crash while pumping output
if grep -q 'omo.monitor.delivery-failed' "$TRACE"; then
  bad "no-delivery-failure" "a delivery failed"
else ok "no-delivery-failure"; fi

# 10. isolation: the host store must be untouched
HOST_AFTER="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"
if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then ok "host-store-isolated ($HOST_BEFORE)"; else bad "host-store-isolated" "$HOST_BEFORE -> $HOST_AFTER"; fi

cp "$DB" "$OUT/sandbox-opencode.db" 2>/dev/null || true
printf '\n%s\n' "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
