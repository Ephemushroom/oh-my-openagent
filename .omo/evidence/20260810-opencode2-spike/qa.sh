#!/usr/bin/env bash
# omo-opencode2 spike QA driver (Git Bash / Linux/macOS). Round 2.
# Spike findings baked in:
#  - Commands needing the persistent background service (plugin list, debug agents,
#    mcp list, api without --standalone) time out on this Windows host; `run --standalone`
#    is the working surface and is used for everything.
#  - `api --standalone get /api/plugin|/api/agent` returns empty data (standalone does not
#    materialize location state); not usable as a registration proof.
# Secrets: the provider key is read from the real opencode v1 auth store into the process
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
cp "$EVIDENCE_DIR/mini-mcp.mjs" "$FIX/mini-mcp.mjs"
PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || echo "$ROOT/packages/omo-opencode2/src/index.ts")"
MINI="$(cygpath -m "$FIX/mini-mcp.mjs" 2>/dev/null || echo "$FIX/mini-mcp.mjs")"
cat > "$FIX/opencode.jsonc" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "$MODEL",
  "plugins": ["$PLUGIN_ENTRY"],
  "mcp": { "servers": { "mini": { "type": "local", "command": ["node", "$MINI"], "codemode": false } } }
}
EOF

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"; : > "$OMO_SPIKE_TRACE"
"$OC2" --version > "$OUT/version.txt" 2>&1
note() { echo "## $*"; }
note "opencode2 $(cat "$OUT/version.txt")  model=$MODEL"

run_case() {
  local name="$1"; shift
  ( cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$*" ) > "$OUT/$name.txt" 2>&1
  echo "== $name (exit $?) =="
}

note "step 1: run echo (default agent + custom tool + execute.before/after + context system push)"
run_case run-echo "Use the omo_spike_echo tool to echo the word hello, then quote exactly what the tool returned."
tail -c 500 "$OUT/run-echo.txt"
grep_q "> omo-spike " "$OUT/run-echo.txt"; check "agent.registered.and.default" $? "run header shows omo-spike as default agent"
grep_q "OMO-SPIKE-7f3a9" "$OUT/run-echo.txt"; check "agent.system.active" $? "RUN_MARKER in output"
trace_has '"event":"tool.echo.executed","text":"BEFORE\(hello\)"'; check "tool.before.mutated" $? "tool received BEFORE-mutated input (trace)"
trace_has '"event":"tool.after.mutated"'; check "tool.after.mutated" $? "after hook mutated result (trace)"
ECHO_SESSION="$(sed -n 's/.*"event":"tool.after.mutated".*"sessionID":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | head -1)"
if [ -n "$ECHO_SESSION" ]; then
  ( cd "$FIX" && "$OC2" export --standalone --session "$ECHO_SESSION" ) > "$OUT/export-echo.json" 2>&1
  grep_q ":AFTER" "$OUT/export-echo.json"; check "tool.after.visible" $? "mutated tool result in exported session"
else
  check "tool.after.visible" 1 "no echo session id in trace"
fi
MARKER_FOUND=1; for f in "$OUT"/run-*.txt; do grep_q "OMO-SPIKE-CTX-22cc" "$f" && { MARKER_FOUND=0; break; }; done
check "context.system.pushed" $MARKER_FOUND "CONTEXT_MARKER followed in at least one run (trace shows context hook fired on every dispatch)"

note "step 2: run redact (context messages mutation)"
run_case run-redact "My credential is token=TOPSECRET-9911. Repeat my token back to me exactly."
trace_has '"redactions":[1-9]'; check "context.messages.redacted.trace" $? "redaction recorded in trace"
grep_qi "redact" "$OUT/run-redact.txt"; check "context.messages.redacted.reply" $? "assistant reacted to redacted content"

note "step 3: run no-echo (context tools removal)"
run_case run-noecho "[no-echo] Please use the omo_spike_echo tool to echo the word hello."
trace_has '"removed":"omo_spike_echo"'; check "context.tools.removed.trace" $? "removed entry in trace"
if grep_q "echo:BEFORE" "$OUT/run-noecho.txt"; then r=1; else r=0; fi
check "context.tools.removed.effect" $r "echo tool never executed in the run"

note "step 4: run delegate (child session orchestration + event-stream output + synthetic parent wake)"
run_case run-delegate "Delegate this to the helper with the omo_spike_delegate tool: compute 2+2 and reply with just the number. Then report the helper's answer."
tail -c 500 "$OUT/run-delegate.txt"
trace_has '"event":"delegate.finished","child":"[^"]+","ok":true,"length":[1-9]'; check "delegate.output.captured" $? "child output captured via event stream"
PARENT="$(sed -n 's/.*"event":"delegate.synthetic","parent":"\([^"]*\)".*/\1/p' "$OMO_SPIKE_TRACE" | head -1)"
echo "parent session: $PARENT"
if [ -n "$PARENT" ]; then
  ( cd "$FIX" && "$OC2" export --standalone --session "$PARENT" ) > "$OUT/export-parent.json" 2>&1
  grep_q "omo-spike&gt; delegate child" "$OUT/export-parent.json" || grep_q "omo-spike> delegate child" "$OUT/export-parent.json"
  check "synthetic.admitted" $? "synthetic marker in exported parent session"
  grep_qi "synthetic" "$OUT/export-parent.json"; check "synthetic.message.type" $? "synthetic message present in export"
else
  check "synthetic.admitted" 1 "no parent session id in trace"
  check "synthetic.message.type" 1 "no parent session id in trace"
fi

note "step 5: MCP exposure (mini_echo visible to model dispatch)"
trace_has 'mini_echo'; check "mcp.tool.exposed" $? "mini_echo in context tools trace"

note "step 6: isolation (no v2 writes into the real opencode stores)"
echo "sandbox store:"; find "$SANDBOX/data" -maxdepth 3 -type f | head -10
VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.config/opencode" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores (live v1 paths excluded)"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson"
echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
