#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
OUT_DIR="$(pwd)/out"
PLUGIN_PATH="$(cygpath -w "$(realpath "$(pwd)/../../../packages/omo-opencode2/src/index.ts")" | sed 's/\\/\\\\/g')"
mkdir -p "$OUT_DIR"

# Fetch key BEFORE overriding HOME
export ZHIPU_API_KEY=$(jq -r '.zhipuai.key' ~/.local/share/opencode/auth.json)

export SANDBOX="$(mktemp -d)"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX"
export USERPROFILE="$SANDBOX"
export OPENCODE_TEST_HOME="$SANDBOX"
export OPENCODE_DISABLE_AUTOUPDATE=1

echo "[QA] Sandbox initialized at $SANDBOX"

export OMO_SPIKE_TRACE="$SANDBOX/trace.ndjson"

OC2="/c/Users/Bryan/AppData/Local/Temp/opencode/oc2/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe"

PROJECT_DIR="$SANDBOX/project"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

cat << 'FILE_EOF' > test.txt
const x = 1;
const y = 2;
FILE_EOF
TEST_FILE_CHECKSUM=$(sha256sum test.txt | awk '{print $1}')

# Build omo-opencode2 index path

cat << CFG_EOF > opencode.jsonc
{
  "model": "zhipuai/glm-4.7",
  "plugins": ["$PLUGIN_PATH"]
}
CFG_EOF

echo "[QA] Running live session for C3 and C4..."
"$OC2" run --standalone --auto "Read test.txt. Look at the LINE#ID tags. Then use the hashline_edit tool to change 'const y = 2;' to 'const y = 3;'. Do NOT use the default edit tool. Use the exact tags from the read output."

echo "[QA] Checking trace for C3 (hashline read enhancer)..."
grep '"event":"hashline.read-enhancer.applied"' "$OMO_SPIKE_TRACE" && echo "[C3 PASS] Read output tagged" || { echo "[C3 FAIL] Read output not tagged"; exit 1; }

echo "[QA] Checking C4 (successful edit)..."
grep '"event":"hashline.edit.success"' "$OMO_SPIKE_TRACE" && echo "[C4 PASS] Edit success traced" || { echo "[C4 FAIL] Edit success not traced"; exit 1; }

NEW_CHECKSUM=$(sha256sum test.txt | awk '{print $1}')
if [ "$NEW_CHECKSUM" != "$TEST_FILE_CHECKSUM" ]; then
  echo "[C4 PASS] File was modified successfully"
else
  echo "[C4 FAIL] File was not modified"
  exit 1
fi

echo "[QA] Preparing for C5 (stale edit)..."
STALE_FILE_CHECKSUM=$NEW_CHECKSUM

echo "[QA] Running live session for C5..."
# We run a new session and force the stale hash
"$OC2" run --standalone --auto "Use the hashline_edit tool to replace line 2 in test.txt with 'const y = 4;'. Use the position '2#ZZ' (which is intentionally wrong/stale). Do not try to correct it, just run the tool with exactly 2#ZZ."

echo "[QA] Checking trace for C5..."
grep '"event":"hashline.edit.error"' "$OMO_SPIKE_TRACE" && echo "[C5 PASS] Edit rejection traced" || { echo "[C5 FAIL] Edit rejection not traced"; exit 1; }

FINAL_CHECKSUM=$(sha256sum test.txt | awk '{print $1}')
if [ "$FINAL_CHECKSUM" == "$STALE_FILE_CHECKSUM" ]; then
  echo "[C5 PASS] File remained byte-identical after stale edit"
else
  echo "[C5 FAIL] File was modified!"
  exit 1
fi

echo "[QA] All QA criteria passed successfully."
