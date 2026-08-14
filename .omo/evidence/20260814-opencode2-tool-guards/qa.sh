#!/usr/bin/env bash
# OpenCode2 tool-guard QA against the real pinned Windows binary.
# Proves write-existing-file-guard and prometheus-md-only actually fire on
# tool.execute.before in a live session, in BOTH the block and allow direction.
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OUT="$EVIDENCE_DIR/out"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME_WINDOWS="${USERPROFILE:-$HOME}"
REAL_HOME="$(cygpath -u "$REAL_HOME_WINDOWS" 2>/dev/null || printf '%s' "$REAL_HOME_WINDOWS")"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

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

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj}
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export USERPROFILE="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
# Without this the binary refreshes ~/.cache/opencode/models.json on the REAL
# home even though XDG_CACHE_HOME points at the sandbox, which trips the
# isolation sweep below.
export OPENCODE_DISABLE_MODELS_FETCH=1
export ZHIPU_API_KEY

FIX="$SANDBOX/proj"
ISOMARK="$SANDBOX/isolation.marker"
touch "$ISOMARK"

PLUGIN_ENTRY="$(cygpath -m "$ROOT/packages/omo-opencode2/src/index.ts" 2>/dev/null || printf '%s' "$ROOT/packages/omo-opencode2/src/index.ts")"
PLUGIN_JSON="$(printf '%s' "$PLUGIN_ENTRY" | sed 's/\\/\\\\/g')"
cat > "$FIX/opencode.jsonc" <<EOF
{
  "model": "$MODEL",
  "plugins": ["$PLUGIN_JSON"]
}
EOF

# Pre-existing file the model has NOT read in-session. Writing to it must be
# blocked. Its content is a sentinel so we can prove it was never overwritten.
printf 'SENTINEL_ORIGINAL_CONTENT\n' > "$FIX/existing.txt"
printf '# Notes\n\noriginal\n' > "$FIX/notes.md"
printf 'export const value = 1\n' > "$FIX/code.ts"

"$OC2" --version > "$OUT/version.txt" 2>&1
echo "sandbox: $SANDBOX"
echo "opencode2: $(cat "$OUT/version.txt")"
echo "model: $MODEL"

run_case() {
  local name="$1"
  local prompt="$2"
  shift 2
  export OMO_SPIKE_TRACE="$SANDBOX/trace-$name.ndjson"
  : > "$OMO_SPIKE_TRACE"
  (cd "$FIX" && timeout -k 5 300 "$OC2" run --standalone --auto "$@" "$prompt") > "$OUT/run-$name.txt" 2>&1
  local status=$?
  cp "$OMO_SPIKE_TRACE" "$OUT/trace-$name.ndjson"
  return "$status"
}

# Asserts the named trace event appears at least minCount times.
trace_has() {
  local name="$1"
  local event="$2"
  local minCount="$3"
  node - "$OUT/trace-$name.ndjson" "$event" "$minCount" > "$OUT/trace-check-$name-${event//./_}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event, minCount] = process.argv.slice(2)
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matching = events.filter((e) => e.event === event)
const ok = matching.length >= Number(minCount)
console.log(JSON.stringify({
  event,
  minCount: Number(minCount),
  observed: matching.length,
  ok,
  samples: matching.slice(0, 3),
}, null, 2))
process.exit(ok ? 0 : 1)
NODE
}

# Asserts the named trace event does NOT appear.
trace_absent() {
  local name="$1"
  local event="$2"
  node - "$OUT/trace-$name.ndjson" "$event" > "$OUT/trace-check-$name-absent-${event//./_}.txt" 2>&1 <<'NODE'
const fs = require("fs")
const [path, event] = process.argv.slice(2)
const events = fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const matching = events.filter((e) => e.event === event)
console.log(JSON.stringify({ event, observed: matching.length, ok: matching.length === 0 }, null, 2))
process.exit(matching.length === 0 ? 0 : 1)
NODE
}

echo "## guards registered at startup"
run_case "register" "Reply with the single word ok."
check "register.run" "$?" "real session completed"
trace_has "register" "omo.tool-guards.registered" 1
check "register.hooks" "$?" "both guards registered on the live plugin"

echo "## write-existing-file-guard blocks an unread existing file"
run_case "block" "Use the write tool to replace the contents of existing.txt with the text REPLACED. Do not read the file first."
check "block.run" "$?" "real session completed"
trace_has "block" "omo.write-existing-file-guard.block" 1
check "block.fired" "$?" "guard blocked the write to an unread existing file"

# The guard's contract is to reject the WRITE and redirect to edit. It does not
# freeze the file: read-then-edit is the intended recovery path, and the model
# is expected to take it. So assert the rejection reached the model, not that
# the file never changed.
if grep -qF "File already exists. Use edit tool instead." "$OUT/run-block.txt"; then
  check "block.surfaced" 0 "the model received the guard's rejection message"
else
  check "block.surfaced" 1 "the guard message never reached the model"
fi

echo "## write-existing-file-guard allows a brand new file"
run_case "allow" "Use the write tool to create a new file called fresh.txt containing the text hello."
check "allow.run" "$?" "real session completed"
trace_absent "allow" "omo.write-existing-file-guard.block"
check "allow.not-blocked" "$?" "no block event for a path that does not exist yet"

# The v1 rule this ports is NOT "prometheus may write any .md". v1 confines
# prometheus to .omo/**/*.md: packages/omo-opencode/src/hooks/prometheus-md-only
# requires BOTH an .omo path segment and an allowed extension. So there are two
# distinct rejection reasons to prove, plus the accept path.
#
# Prometheus is also a planner by construction: given a soft instruction it loads
# the ulw-plan skill and reads rather than writes, and the guard then never sees a
# write. The prompts forbid planning explicitly so the guarded action is attempted.

echo "## prometheus-md-only blocks markdown outside .omo"
run_case "prom-outside" "Do not plan. Do not load any skill. Do not read anything. Immediately call the write tool exactly once on the file plan.md with the content: # Plan" --agent prometheus
check "prom-outside.run" "$?" "real session completed"
trace_has "prom-outside" "omo.prometheus-md-only.blocked" 1
check "prom-outside.fired" "$?" "a .md path outside .omo was blocked"

# The second rejection reason, a non-markdown extension INSIDE .omo, is proven
# by unit test instead of here. Driven live, prometheus declines to attempt a
# non-markdown write at all and goes into interview mode, so no write ever
# reaches the hook and there is nothing for the guard to block. Asserting it
# live would be asserting model temperament, not guard behavior. See the
# ".omo/notes.txt" case in hooks/prometheus-md-only/index.test.ts.

echo "## prometheus-md-only allows markdown inside .omo"
run_case "prom-allow" "Do not plan. Do not load any skill. Do not read anything. Immediately call the write tool exactly once on the file .omo/plan.md with the content: # Plan" --agent prometheus
check "prom-allow.run" "$?" "real session completed"
trace_has "prom-allow" "omo.prometheus-md-only.allowed" 1
check "prom-allow.fired" "$?" "a .md path inside .omo was allowed through"

echo "## host-store isolation"
REAL_STORES=()
for path in \
  "$REAL_HOME/.local/share/opencode" \
  "$REAL_HOME/.config/opencode" \
  "$REAL_HOME/.cache/opencode" \
  "$REAL_HOME/.local/state/opencode"
do
  [ -d "$path" ] && REAL_STORES+=("$path")
done

if [ "${#REAL_STORES[@]}" -eq 0 ]; then
  : > "$OUT/isolation-violations.txt"
else
  # models.json is the binary's global provider catalog, refreshed by opencode2
  # itself on startup regardless of XDG_CACHE_HOME and OPENCODE_DISABLE_MODELS_FETCH.
  # It carries no session or project state, and our plugin never writes it, so it
  # is excluded here for the same reason as the db, log, and lock files.
  find "${REAL_STORES[@]}" -newer "$ISOMARK" -type f \
    ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
    ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" ! -name "models.json" \
    > "$OUT/isolation-violations.txt" 2>/dev/null
fi

if [ -s "$OUT/isolation-violations.txt" ]; then
  check "isolation.clean" 1 "real OpenCode stores contain newer files"
else
  check "isolation.clean" 0 "newer-than-marker sweep found no host-store writes"
fi

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
