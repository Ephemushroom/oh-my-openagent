#!/usr/bin/env bash
# QA for the opencode2 plugin API bump (0.0.0-next-17055 -> 0.0.0-next-17444).
#
# What it proves:
#   1. skills-registered  our rewritten registration runs and adds every bundled skill
#   2. skills-visible     opencode2 itself reports those skills (first-party, via its API)
#   3. answered           a real session on the new binary still completes end to end
#   4. isolation          no writes land in the host opencode/codex stores
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/out"; mkdir -p "$OUT"
OC2="${OPENCODE2_BIN:-/c/Users/Bryan/AppData/Local/Temp/opencode/oc2-next/node_modules/@opencode-ai/cli-windows-x64/bin/opencode2.exe}"
REAL_HOME="$(cygpath -u "${USERPROFILE:-$HOME}" 2>/dev/null || printf '%s' "${USERPROFILE:-$HOME}")"
ZHIPU_API_KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((a.zhipuai&&a.zhipuai.key)||"")' "$REAL_HOME/.local/share/opencode/auth.json")"

PASS=0; FAIL=0
check() { # name, condition-exit, description
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
cat > "$P/opencode.jsonc" <<EOF
{ "model": "zhipuai/glm-4.7", "plugins": ["$(printf '%s' "$PLUGIN" | sed 's/\\/\\\\/g')"] }
EOF
printf '{}\n' > "$P/package.json"
printf '%s\n' '{"[opencode2]":{"agents":{"sisyphus":{"model":"zhipuai/glm-4.7"}}}}' > "$P/.omo/omo.json"

echo "sandbox: $S"
echo "binary:  $OC2"
echo "plugin:  $PLUGIN"
echo

cd "$P"

echo "=== case 1: real session on the bumped binary ==="
export OMO_SPIKE_TRACE="$OUT/trace-bump.ndjson"; : > "$OMO_SPIKE_TRACE"
timeout -k 5 300 "$OC2" run --standalone --auto 'What is 2+2? Answer with just the number.' > "$OUT/run-bump.txt" 2>&1 || true
tail -3 "$OUT/run-bump.txt"

node -e '
const fs=require("fs");
const e=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const s=e.find(x=>x.event==="omo.skills.registered");
fs.writeFileSync(process.argv[2], JSON.stringify(s||null));
' "$OMO_SPIKE_TRACE" "$OUT/skills-event.json"
SKILL_COUNT="$(node -e 'const s=require(process.argv[1]);process.stdout.write(String(s&&s.count||0))' "$OUT/skills-event.json")"
[ "${SKILL_COUNT:-0}" -ge 10 ]; check "skills-registered" $? "registration added $SKILL_COUNT bundled skills"

grep -qE '(^|[^0-9])4([^0-9]|$)' "$OUT/run-bump.txt"; check "answered" $? "session completed and answered on next-17444"

echo
echo "=== case 2: opencode2 can actually load a bundled skill ==="
# The v2 skill tool resolves by id against its own registered skill list, so a
# successful load is proof the rewritten registration landed in core, not just
# that our callback ran. "Mode Gate" is a heading unique to git-master/SKILL.md.
export OMO_SPIKE_TRACE="$OUT/trace-skill.ndjson"; : > "$OMO_SPIKE_TRACE"
timeout -k 5 300 "$OC2" run --standalone --auto \
  'Use the skill tool with id "git-master". Then reply with the exact text of its first "##" heading and nothing else.' \
  > "$OUT/run-skill.txt" 2>&1 || true
tail -5 "$OUT/run-skill.txt"

# The model's prose is not a reliable assertion target, so the proof comes from
# opencode2's own session store: the skill tool result must carry git-master's
# body. "Mode Gate" is a heading that exists only in git-master/SKILL.md, so
# finding it in the transcript proves core resolved the id we registered and
# read the file at the location we gave it.
if grep -rqs "Mode Gate" "$S/data/opencode"; then SKILL_LOADED=0; else SKILL_LOADED=1; fi
grep -rqs "unable to load" "$S/data/opencode" && SKILL_LOADED=1
printf '  git-master body in session store: %s\n' "$([ $SKILL_LOADED -eq 0 ] && echo yes || echo no)"
check "skills-visible" "$SKILL_LOADED" "git-master body reached the transcript via opencode2's own skill tool"

echo
echo "=== isolation sweep ==="
AFTER="$(host_snapshot)"
[ "$BEFORE" = "$AFTER" ]; check "isolation" $? "0 host-store writes"

echo
echo "summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
