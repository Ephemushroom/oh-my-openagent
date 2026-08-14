#!/usr/bin/env bash
# omo-opencode2 installer plugin-entry QA driver.
#
# Subject under test: `runOpenCode2Installer()` now writes the OMO plugin entry
# into opencode.json `plugins` in addition to `mcp.servers`, so a single install
# produces a config that actually loads the v2 adapter.
#
# Proofs:
#  - the real installer entry writes the plugin path, preserving comments, the
#    mcp block, and a pre-existing user plugin entry
#  - a second run is idempotent (no duplicate entry)
#  - the resulting config LOADS the plugin in a real opencode2 session
#    (trace omo.registration.complete)
#  - the user's real opencode config is byte-identical throughout
set -uo pipefail

EVIDENCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE_DIR/../../.." && pwd)"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
MODEL="zhipuai/glm-4.7"
REAL_HOME="${USERPROFILE:-$HOME}"
AUTH_STORE="$REAL_HOME/.local/share/opencode/auth.json"

PASS=0; FAIL=0
check() { if [ "$2" = "0" ]; then echo "PASS  $1  ($3)"; PASS=$((PASS+1)); else echo "FAIL  $1  ($3)"; FAIL=$((FAIL+1)); fi }
note() { echo; echo "## $*"; }

[ -x "$OC2" ] || { echo "opencode2 binary not found: $OC2"; exit 2; }
[ -f "$AUTH_STORE" ] || { echo "v1 auth store not found: $AUTH_STORE"; exit 2; }
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$AUTH_STORE")"
[ -n "$ZHIPU_API_KEY" ] || { echo "no zhipuai key in v1 auth store"; exit 2; }

OUT="$EVIDENCE_DIR/out"; mkdir -p "$OUT"

# Real-config integrity baseline. These files must never be touched.
REAL_CFG_DIR="$REAL_HOME/.config/opencode"
sha_of() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "ABSENT"; }
REAL_JSON_BEFORE="$(sha_of "$REAL_CFG_DIR/opencode.json")"
REAL_JSONC_BEFORE="$(sha_of "$REAL_CFG_DIR/opencode.jsonc")"

SANDBOX="$(mktemp -d)"
echo "sandbox: $SANDBOX"
mkdir -p "$SANDBOX"/{data,config,cache,state,home,proj}
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home" USERPROFILE="$SANDBOX/home" OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 ZHIPU_API_KEY
ISOMARK="$SANDBOX/iso.mark"; touch "$ISOMARK"

# Point the installer at a sandbox config dir so the real one is never a target.
SBX_CFG_DIR="$SANDBOX/config/opencode"
mkdir -p "$SBX_CFG_DIR"
export OPENCODE_CONFIG_DIR="$SBX_CFG_DIR"
CFG="$SBX_CFG_DIR/opencode.json"

# Seed with a comment, a pre-existing user plugin, and a model. All three must
# survive the install.
cat > "$CFG" <<EOF
{
  // user comment that must survive the installer
  "model": "$MODEL",
  "plugins": [
    "some-user-plugin"
  ]
}
EOF
cp "$CFG" "$OUT/config-before.json"

"$OC2" --version > "$OUT/version.txt" 2>&1

note "step 1: run the real installer entry against the sandbox config"
( cd "$ROOT" && bun "$EVIDENCE_DIR/run-installer.ts" ) > "$OUT/install-1.json" 2>&1
INSTALL1_RC=$?
cat "$OUT/install-1.json"
check "install.exit" "$INSTALL1_RC" "runOpenCode2Installer() completed"
cp "$CFG" "$OUT/config-after.json"

node - "$CFG" "$ROOT" > "$OUT/assert-1.json" 2>&1 <<'NODE'
const fs = require("fs")
const path = require("path")
const [cfgPath, root] = process.argv.slice(2)
const raw = fs.readFileSync(cfgPath, "utf8")
const stripped = raw.replace(/^\s*\/\/.*$/gm, "")
const cfg = JSON.parse(stripped)
const expected = path.join(root, "packages", "omo-opencode2", "src", "index.ts")
const plugins = cfg.plugins ?? []
const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase()
console.log(JSON.stringify({
  commentPreserved: /user comment that must survive/.test(raw),
  userPluginPreserved: plugins.includes("some-user-plugin"),
  pluginEntryWritten: plugins.some((p) => norm(p) === norm(expected)),
  pluginEntryValue: plugins.find((p) => norm(p) === norm(expected)) ?? null,
  mcpServers: Object.keys(cfg.mcp?.servers ?? {}).sort(),
  modelPreserved: cfg.model,
}, null, 2))
NODE
cat "$OUT/assert-1.json"
grep -q '"commentPreserved": true' "$OUT/assert-1.json"; check "cfg.comment" $? "JSONC comment survived the write"
grep -q '"userPluginPreserved": true' "$OUT/assert-1.json"; check "cfg.user-plugin" $? "pre-existing user plugin entry survived"
grep -q '"pluginEntryWritten": true' "$OUT/assert-1.json"; check "cfg.plugin-entry" $? "omo-opencode2 plugin entry written"
grep -q '"codegraph"' "$OUT/assert-1.json"; check "cfg.mcp" $? "mcp.servers still written in the same run"

note "step 2: idempotency — a second install must not duplicate the entry"
( cd "$ROOT" && bun "$EVIDENCE_DIR/run-installer.ts" ) > "$OUT/install-2.json" 2>&1
node - "$CFG" "$ROOT" > "$OUT/assert-2.json" 2>&1 <<'NODE'
const fs = require("fs")
const path = require("path")
const [cfgPath, root] = process.argv.slice(2)
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8").replace(/^\s*\/\/.*$/gm, ""))
const expected = path.join(root, "packages", "omo-opencode2", "src", "index.ts")
const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase()
const hits = (cfg.plugins ?? []).filter((p) => norm(p) === norm(expected))
console.log(JSON.stringify({ occurrences: hits.length, totalPlugins: (cfg.plugins ?? []).length }, null, 2))
NODE
cat "$OUT/assert-2.json"
grep -q '"occurrences": 1' "$OUT/assert-2.json"; check "cfg.idempotent" $? "second install left exactly one entry"
grep -q '"pluginAdded": false' "$OUT/install-2.json"; check "install.idempotent-report" $? "second install reported pluginAdded=false"

note "step 3: LIVE — the installer-written config actually loads the plugin"
export OMO_SPIKE_TRACE="$SANDBOX/trace.ndjson"; : > "$OMO_SPIKE_TRACE"
( cd "$SANDBOX/proj" && timeout -k 5 300 "$OC2" run --standalone --auto "reply with the single word ok." ) > "$OUT/run-live.txt" 2>&1
echo "live run exit: $?"
tail -20 "$OUT/run-live.txt"
cp "$OMO_SPIKE_TRACE" "$OUT/trace.ndjson" 2>/dev/null || true
grep -q '"event":"omo.registration.complete"' "$OUT/trace.ndjson"; check "live.plugin-loaded" $? "OMO plugin registered agents in a real opencode2 session"

note "step 4: the user's real opencode config was never touched"
REAL_JSON_AFTER="$(sha_of "$REAL_CFG_DIR/opencode.json")"
REAL_JSONC_AFTER="$(sha_of "$REAL_CFG_DIR/opencode.jsonc")"
{ echo "opencode.json  before=$REAL_JSON_BEFORE after=$REAL_JSON_AFTER"
  echo "opencode.jsonc before=$REAL_JSONC_BEFORE after=$REAL_JSONC_AFTER"; } > "$OUT/real-config-integrity.txt"
cat "$OUT/real-config-integrity.txt"
[ "$REAL_JSON_BEFORE" = "$REAL_JSON_AFTER" ] && [ "$REAL_JSONC_BEFORE" = "$REAL_JSONC_AFTER" ]
check "isolation.real-config" $? "real opencode config sha256 unchanged"

VIOLATIONS="$(find "$REAL_HOME/.local/share/opencode" "$REAL_CFG_DIR" -newer "$ISOMARK" -type f \
  ! -path "*/shell/*" ! -path "*/snapshot/*" ! -path "*/storage/*" \
  ! -name "opencode.db*" ! -name "*.log" ! -name "*.lock" 2>/dev/null | head -20)"
echo "$VIOLATIONS" > "$OUT/isolation-violations.txt"
if [ -z "$VIOLATIONS" ]; then check "isolation.clean" 0 "no new files in real stores"; else check "isolation.clean" 1 "$VIOLATIONS"; fi

echo; note "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
