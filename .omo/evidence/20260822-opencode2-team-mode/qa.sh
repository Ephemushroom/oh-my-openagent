#!/usr/bin/env bash
# OpenCode2 Team Mode live QA. Assertions use OMO_SPIKE_TRACE, never transcript prose.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OUT="$EVIDENCE_DIR/out"
OC2="${OPENCODE2_BIN:-$(command -v opencode2 2>/dev/null || true)}"
MODEL="zhipuai/glm-4.7"
REAL_HOME_WINDOWS="${USERPROFILE:-$HOME}"
REAL_HOME="$(cygpath -u "$REAL_HOME_WINDOWS" 2>/dev/null || printf '%s' "$REAL_HOME_WINDOWS")"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"
HOST_DB="$REAL_HOME/.local/share/opencode/opencode.db"

mkdir -p "$OUT"
exec > >(tee "$OUT/qa-summary.txt") 2>&1

PASS=0
FAIL=0

check() {
  if [ "$2" = "0" ]; then
    echo "PASS  $1  ($3)"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $1  ($3)"
    FAIL=$((FAIL + 1))
  fi
}

session_count() {
  HOST_DB="$HOST_DB" bun -e 'import { Database } from "bun:sqlite"; const p=process.env.HOST_DB; if(!p){console.log(0);process.exit(0)}; try { const db=new Database(p,{readonly:true}); const row=db.query("SELECT count(*) AS count FROM session_v2").get(); console.log(typeof row?.count === "number" ? row.count : 0); db.close() } catch { console.log(0) }' 2>/dev/null
}

[ -n "$OC2" ] && [ -x "$OC2" ] || { echo "opencode2 binary not found"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

HOST_COUNT_BEFORE="$(session_count)"
printf '%s\n' "$HOST_COUNT_BEFORE" > "$OUT/host-session-v2-before.txt"

echo "running unit gate"
(cd "$ROOT" && bun test packages/omo-opencode2/src) > "$OUT/unit-gate.txt" 2>&1
check "unit.gate" "$?" "bun test packages/omo-opencode2/src"

echo "running type gate"
(cd "$ROOT" && bun run typecheck) > "$OUT/typecheck.txt" 2>&1
check "typecheck.gate" "$?" "bun run typecheck"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX"/{data,config,cache,state,home,positive,negative}
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

POS="$SANDBOX/positive"
mkdir -p "$POS/.omo"
cat > "$POS/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
cat > "$POS/.omo/omo.json" <<'EOF'
{
  "[opencode2]": {
    "team_mode": { "enabled": true }
  }
}
EOF

export OMO_SPIKE_TRACE="$SANDBOX/trace-positive.ndjson"
: > "$OMO_SPIKE_TRACE"
POSITIVE_PROMPT='Use the team_create tool to create a team named qa-team with exactly two members: worker-one and worker-two. Give each a short prompt to wait for team instructions and report through team_send_message; use the default member agent. After team_create returns, use team_send_message to send worker-one the exact body "qa-message-flow". Then call team_status for that team run. Finally call team_delete for that team run. Do not finish until all four tool calls return.'
(cd "$POS" && timeout -k 5 420 "$OC2" run --standalone --auto "$POSITIVE_PROMPT") > "$OUT/run-positive.txt" 2>&1
check "positive.run" "$?" "real enabled Team Mode session completed"
cp "$OMO_SPIKE_TRACE" "$OUT/trace-positive.ndjson"

if [ -d "$POS/.omo/teams/qa-team" ]; then
  find "$POS/.omo/teams/qa-team" -maxdepth 2 -type f -print > "$OUT/team-directory.txt"
  check "positive.team-dir" 0 "project .omo/teams/qa-team exists"
else
  : > "$OUT/team-directory.txt"
  check "positive.team-dir" 1 "project .omo/teams/qa-team missing"
fi

node - "$OUT/trace-positive.ndjson" > "$OUT/trace-positive-analysis.json" 2>&1 <<'NODE'
const fs = require("fs")
const events = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
const registered = events.find((entry) => entry.event === "omo.team.registered")
const analysis = {
  registered: Array.isArray(registered?.tools) && registered.tools.length === 12,
  created: events.some((entry) => entry.event === "omo.team.created" && entry.teamName === "qa-team"),
  memberStarted: events.filter((entry) => entry.event === "omo.team.member-started" && entry.teamRunId).length,
  messageSent: events.some((entry) => entry.event === "omo.team.message-sent" && entry.to === "worker-one"),
  messageDelivered: events.some((entry) => entry.event === "omo.team.message-delivered" && entry.recipient === "worker-one"),
  statusRead: events.some((entry) => entry.event === "omo.team.status-read" && entry.members === 3),
  deleted: events.some((entry) => entry.event === "omo.team.deleted"),
}
console.log(JSON.stringify(analysis, null, 2))
NODE

node -e 'const a=require(process.argv[1]);process.exit(a.registered?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.registered" "$?" "trace reports all 12 team tools"
node -e 'const a=require(process.argv[1]);process.exit(a.created?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.created" "$?" "trace reports qa-team creation"
node -e 'const a=require(process.argv[1]);process.exit(a.memberStarted>=1?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.member-started" "$?" "at least one real member session started"
node -e 'const a=require(process.argv[1]);process.exit(a.messageSent&&a.messageDelivered?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.message-flow" "$?" "lead message persisted and queued to worker-one"
node -e 'const a=require(process.argv[1]);process.exit(a.statusRead?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.status" "$?" "team_status observed three total participants"
node -e 'const a=require(process.argv[1]);process.exit(a.deleted?0:1)' "$OUT/trace-positive-analysis.json"
check "positive.deleted" "$?" "team_delete reached completion"

NEG="$SANDBOX/negative"
cat > "$NEG/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF
export OMO_SPIKE_TRACE="$SANDBOX/trace-negative.ndjson"
: > "$OMO_SPIKE_TRACE"
(cd "$NEG" && timeout -k 5 300 "$OC2" run --standalone --auto 'Reply with the single token negative-ok. Do not call tools.') > "$OUT/run-negative.txt" 2>&1
check "negative.run" "$?" "real default-off session completed"
cp "$OMO_SPIKE_TRACE" "$OUT/trace-negative.ndjson"

node - "$OUT/trace-negative.ndjson" > "$OUT/trace-negative-analysis.json" 2>&1 <<'NODE'
const fs = require("fs")
const events = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
console.log(JSON.stringify({
  disabled: events.some((entry) => entry.event === "omo.team.disabled"),
  registered: events.some((entry) => entry.event === "omo.team.registered"),
}, null, 2))
NODE
node -e 'const a=require(process.argv[1]);process.exit(a.disabled&&!a.registered?0:1)' "$OUT/trace-negative-analysis.json"
check "negative.default-off" "$?" "disabled trace present and registration absent"

HOST_COUNT_AFTER="$(session_count)"
printf '%s\n' "$HOST_COUNT_AFTER" > "$OUT/host-session-v2-after.txt"
if [ "$HOST_COUNT_BEFORE" = "$HOST_COUNT_AFTER" ]; then
  check "isolation.session-count" 0 "host session_v2 count unchanged ($HOST_COUNT_BEFORE)"
else
  check "isolation.session-count" 1 "host session_v2 changed $HOST_COUNT_BEFORE -> $HOST_COUNT_AFTER"
fi

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
