#!/usr/bin/env bash
# QA for the opencode2 `look_at` capability gate.
#
# What it proves:
#   0. discovery      what the REAL catalog reports as vision capable
#   1. registered     the tool reaches core's tool registry
#   2. delegated      a caller WITHOUT vision routes to a vision model
#   3. passthrough    a caller WITH vision is told to use `read` instead
#   4. isolation      no writes land in the host opencode/codex stores
#
# Cases 2 and 3 are the both-directions rule: a gate that only ever fires one
# way is unproven. They are asserted from OMO_SPIKE_TRACE, not model prose.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/out"; mkdir -p "$OUT"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
REAL_HOME="$(cygpath -u "${USERPROFILE:-$HOME}" 2>/dev/null || printf '%s' "${USERPROFILE:-$HOME}")"
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$REAL_HOME/.local/share/opencode/auth.json")"

# Raw traces hold the full catalog of ~200 providers (250 KB each) and are
# reviewer-noise, so they stay in the sandbox. Only the look_at events, which
# are the actual proof, are kept as evidence.
TRACEDIR="$(mktemp -d)"
keep_lookat_events() { # $1 = raw trace, $2 = destination
  grep 'omo\.lookat\.' "$1" > "$2" 2>/dev/null || : > "$2"
}

PASS=0; FAIL=0
check() {
  if [ "$2" -eq 0 ]; then printf 'PASS  %s  (%s)\n' "$1" "$3"; PASS=$((PASS+1));
  else printf 'FAIL  %s  (%s)\n' "$1" "$3"; FAIL=$((FAIL+1)); fi
}

host_snapshot() {
  find "$REAL_HOME/.local/share/opencode" "$REAL_HOME/.codex" -type f 2>/dev/null \
    | grep -v -e 'opencode\.db' -e '\.log$' -e '\.lock$' -e '/shell/' -e '/snapshot/' \
              -e '/storage/' -e 'models\.json' -e '/tool-output/' \
    | sort | xargs -r sha1sum 2>/dev/null | sha1sum
}
BEFORE="$(host_snapshot)"

S="$(mktemp -d)"
mkdir -p "$S"/{data,config,cache,state,home}
P="$S/home/project"; mkdir -p "$P/.omo"
export XDG_DATA_HOME="$S/data" XDG_CONFIG_HOME="$S/config" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state"
export HOME="$S/home" USERPROFILE="$S/home" OPENCODE_TEST_HOME="$S/home"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 ZHIPU_API_KEY

PLUGIN="$(cygpath -m "$ROOT/../../../packages/omo-opencode2/src/index.ts")"
PLUGIN_ESC="$(printf '%s' "$PLUGIN" | sed 's/\\/\\\\/g')"
printf '{}\n' > "$P/package.json"

# A real 1x1 PNG so look_at points at an actual media file on disk.
IMG="$P/probe.png"
node -e 'require("fs").writeFileSync(process.argv[1],Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64"))' "$IMG"
IMG_WIN="$(cygpath -m "$IMG")"

write_config() { # $1 = model
  cat > "$P/opencode.jsonc" <<EOF
{ "model": "$1", "plugins": ["$PLUGIN_ESC"] }
EOF
  printf '%s\n' "{\"[opencode2]\":{\"agents\":{\"sisyphus\":{\"model\":\"$1\"}}}}" > "$P/.omo/omo.json"
}

trace_events() { # $1 = trace file, $2 = event name -> prints matching lines
  node -e '
const fs=require("fs");
const lines=fs.existsSync(process.argv[1])?fs.readFileSync(process.argv[1],"utf8").trim().split("\n"):[];
for(const l of lines.filter(Boolean)){let e;try{e=JSON.parse(l)}catch{continue}
  if(e.event===process.argv[2]) console.log(JSON.stringify(e));}
' "$1" "$2"
}

echo "sandbox: $S"
echo "binary:  $OC2"
echo "plugin:  $PLUGIN"
echo "image:   $IMG_WIN"
echo

cd "$P"

echo "=== case 1+2: caller WITHOUT vision must delegate ==="
write_config "zhipuai/glm-4.7"
export OMO_SPIKE_TRACE="$TRACEDIR/trace-delegate.ndjson"; : > "$OMO_SPIKE_TRACE"
timeout -k 5 420 "$OC2" run --standalone --auto \
  "Call the look_at tool with file_path \"$IMG_WIN\" and goal \"describe this image\". Do not use read." \
  > "$OUT/run-delegate.txt" 2>&1 || true
tail -5 "$OUT/run-delegate.txt"

# Summarise the catalog rather than dumping it. The raw snapshot lists every
# model of ~200 providers, which is reviewer-noise and drags legacy model ids
# into committed evidence (the repo audits committed surfaces for those).
trace_events "$OMO_SPIKE_TRACE" "omo.catalog.snapshot" | tail -1 > "$OUT/catalog-raw.tmp"
node -e '
const fs=require("fs");
const raw=fs.readFileSync(process.argv[1],"utf8").trim();
if(!raw){fs.writeFileSync(process.argv[2],"{}");process.exit(0)}
const e=JSON.parse(raw);
const vision=e.visionModels||[];
fs.writeFileSync(process.argv[2], JSON.stringify({
  availableModels: e.availableModels,
  providers: Array.isArray(e.providers)?e.providers.length:undefined,
  visionModelCount: vision.length,
  visionModelSelected: vision[0],
}, null, 2));
' "$OUT/catalog-raw.tmp" "$OUT/catalog-summary.json"
rm -f "$OUT/catalog-raw.tmp"
echo "  catalog: $(cat "$OUT/catalog-summary.json" | tr -d '\n')"

trace_events "$OMO_SPIKE_TRACE" "omo.lookat.tool-registered" > "$OUT/registered.json"
[ -s "$OUT/registered.json" ]; check "registered" $? "look_at reached core's tool registry"

trace_events "$OMO_SPIKE_TRACE" "omo.lookat.delegated" > "$OUT/delegated.json"
DELEGATED=$?
if [ -s "$OUT/delegated.json" ]; then DELEGATED=0; else DELEGATED=1; fi
echo "  delegated event: $(cat "$OUT/delegated.json")"
check "delegated" "$DELEGATED" "blind caller (glm-4.7) routed to a vision model"
keep_lookat_events "$OMO_SPIKE_TRACE" "$OUT/lookat-events-delegate.ndjson"

echo
echo "=== case 3: caller WITH vision must pass through ==="
# Pick a vision-capable model the real catalog actually reports. Without one,
# the passthrough branch cannot be driven live and the case is reported as a gap
# rather than silently skipped.
VISION_MODEL="$(node -e '
const fs=require("fs");
const p=process.argv[1];
if(!fs.existsSync(p)){process.exit(0)}
const raw=fs.readFileSync(p,"utf8").trim();
if(!raw){process.exit(0)}
process.stdout.write(JSON.parse(raw).visionModelSelected||"");
' "$OUT/catalog-summary.json")"
echo "  vision model from catalog: ${VISION_MODEL:-<none>}"

if [ -n "$VISION_MODEL" ]; then
  write_config "$VISION_MODEL"
  export OMO_SPIKE_TRACE="$TRACEDIR/trace-passthrough.ndjson"; : > "$OMO_SPIKE_TRACE"
  timeout -k 5 420 "$OC2" run --standalone --auto \
    "Call the look_at tool with file_path \"$IMG_WIN\" and goal \"describe this image\"." \
    > "$OUT/run-passthrough.txt" 2>&1 || true
  tail -5 "$OUT/run-passthrough.txt"
  trace_events "$OMO_SPIKE_TRACE" "omo.lookat.passthrough" > "$OUT/passthrough.json"
  if [ -s "$OUT/passthrough.json" ]; then PT=0; else PT=1; fi
  echo "  passthrough event: $(cat "$OUT/passthrough.json")"
  check "passthrough" "$PT" "sighted caller ($VISION_MODEL) told to use read"
  keep_lookat_events "$OMO_SPIKE_TRACE" "$OUT/lookat-events-passthrough.ndjson"
else
  printf 'GAP   passthrough  (no vision-capable model in this account catalog)\n'
fi

echo
echo "=== isolation sweep ==="
AFTER="$(host_snapshot)"
[ "$BEFORE" = "$AFTER" ]; check "isolation" $? "0 host-store writes"

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
