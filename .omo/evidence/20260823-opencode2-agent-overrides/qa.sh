#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"
REPO="$(cd "$HERE/../../.." && pwd)"
mkdir -p "$OUT"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "${2:-}"; }

REAL_HOME="$HOME"
BIN="${OPENCODE2_BIN:-$REAL_HOME/.bun/bin/opencode2.exe}"
[ -x "$BIN" ] || { echo "opencode2 binary not found at $BIN"; exit 2; }
"$BIN" --version > "$OUT/version.txt" 2>&1

KEY="$(node -e 'const a=require(require("os").homedir()+"/.local/share/opencode/auth.json");process.stdout.write(a.zhipuai?.key??"")' 2>/dev/null || true)"
[ -n "$KEY" ] || { echo "no zhipuai key in auth.json"; exit 2; }

HOST_DB="$REAL_HOME/.local/share/opencode/opencode.db"
HOST_BEFORE="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT" 2>/dev/null || true' EXIT
PLUGIN="$(cygpath -m "$REPO/packages/omo-opencode2/src/index.ts")"

run_case() {
  local name="$1"
  local with_overrides="$2"
  local sandbox="$ROOT/$name"
  mkdir -p "$sandbox/home/project/.omo" "$sandbox/config/opencode" "$sandbox/data"

  cat > "$sandbox/config/opencode/opencode.json" <<EOF
{ "\$schema": "https://opencode.ai/config.json", "plugin": ["$PLUGIN"] }
EOF

  if [ "$with_overrides" = "yes" ]; then
    cat > "$sandbox/home/project/.omo/omo.json" <<'EOF'
{
  "[opencode2]": {
    "default_agent": "atlas",
    "agents": {
      "sisyphus": { "model": "qa-primary/sisyphus-model", "variant": "primary-variant" },
      "oracle": { "model": "qa-subagent/oracle-model", "variant": "subagent-variant" },
      "quick": { "model": "qa-category/quick-model", "variant": "category-variant" }
    }
  }
}
EOF
  fi

  (
    export HOME="$sandbox/home" USERPROFILE="$sandbox/home"
    export XDG_DATA_HOME="$sandbox/data" XDG_CONFIG_HOME="$sandbox/config"
    export XDG_CACHE_HOME="$sandbox/cache" XDG_STATE_HOME="$sandbox/state"
    export OPENCODE_TEST_HOME="$sandbox/home"
    export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
    export ZHIPU_API_KEY="$KEY"
    export OMO_SPIKE_TRACE="$sandbox/trace.ndjson"
    cd "$sandbox/home/project"
    git init -q . 2>/dev/null || true
    echo x > sample.txt
    timeout -k 5 300 "$BIN" run --standalone --auto --agent sisyphus --model zhipuai/glm-4.7 \
      'Read sample.txt and reply DONE.' > "$OUT/$name-run.txt" 2>&1
  )
  cp "$sandbox/trace.ndjson" "$OUT/$name-trace.ndjson"
}

run_case positive yes
run_case negative no

node - "$OUT/positive-trace.ndjson" "$OUT/negative-trace.ndjson" "$OUT/assertions.json" <<'EOF'
const fs = require("node:fs")
const [positivePath, negativePath, outputPath] = process.argv.slice(2)
const read = (path) => fs.readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
const positive = read(positivePath)
const negative = read(negativePath)
const registered = (rows, id) => rows.find((row) => row.event === "omo.agent.registered" && row.id === id)
const category = (rows, id) => rows.find((row) => row.event === "omo.category.registered" && row.id === id)
const defaultAgent = (rows) => rows.find((row) => row.event === "omo.agent.default")
const assertions = {
  positive_primary: registered(positive, "sisyphus")?.model === "qa-primary/sisyphus-model",
  positive_subagent: registered(positive, "oracle")?.model === "qa-subagent/oracle-model",
  positive_category: category(positive, "quick")?.model === "qa-category/quick-model",
  positive_default: defaultAgent(positive)?.id === "atlas",
  negative_no_qa_models: !negative.some((row) => typeof row.model === "string" && row.model.startsWith("qa-")),
  negative_default: defaultAgent(negative)?.id === "sisyphus",
}
fs.writeFileSync(outputPath, JSON.stringify(assertions, null, 2) + "\n")
if (Object.values(assertions).some((value) => value !== true)) process.exit(1)
EOF

if [ "$?" -eq 0 ]; then ok "trace-overrides-both-directions"; else bad "trace-overrides-both-directions" "see out/assertions.json"; fi
if [ -s "$OUT/positive-trace.ndjson" ]; then ok "positive-trace-non-empty"; else bad "positive-trace-non-empty"; fi
if [ -s "$OUT/negative-trace.ndjson" ]; then ok "negative-trace-non-empty"; else bad "negative-trace-non-empty"; fi

HOST_AFTER="$(sqlite3 "$HOST_DB" 'select count(*) from session_v2' 2>/dev/null || echo NA)"
printf 'before=%s\nafter=%s\n' "$HOST_BEFORE" "$HOST_AFTER" > "$OUT/host-isolation.txt"
if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then ok "host-store-isolated ($HOST_BEFORE)"; else bad "host-store-isolated" "$HOST_BEFORE -> $HOST_AFTER"; fi

printf '\nPASS=%s FAIL=%s\n' "$PASS" "$FAIL" | tee "$OUT/qa-summary.txt"
[ "$FAIL" -eq 0 ]
