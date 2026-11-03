#!/bin/bash
# Every suite, one at a time, against the app in this repo.
#
#   ./tests/run.sh
#
# Needs playwright-core and a Chromium binary. Neither is committed:
#
#   npm install --no-save playwright-core
#   export CHROME=/path/to/chrome          # if not at the default below
#
# Serial on purpose. The suites share one mock backend and each resets it on
# start, so two in flight wipe each other and invent failures that aren't
# real. Minutes saved here get spent threefold chasing phantoms. Don't
# "optimise" it.
#
# Verdict is the exit code AND the output: a few suites never call
# process.exit, and would otherwise report success while printing FAIL.

cd "$(dirname "$0")"
export APP_DIR="$(cd .. && pwd)"
export SP="$PWD" SP_DIR="$PWD"
export CHROME_PATH="${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}"

node mock-supabase.js >/tmp/mock.log 2>&1 &
MOCK=$!
for i in $(seq 40); do curl -sf -m 1 http://127.0.0.1:54321/__state >/dev/null && break; sleep 0.25; done

green=0; red=0; failing=""
for f in *.js; do
  case "$f" in
    mock-supabase.js) continue;;
    shot-*.js|*-shot.js) continue;;     # screenshot tools, not assertions
  esac
  out=$(timeout 300 node "$f" 2>&1); code=$?
  if [ $code -ne 0 ] || echo "$out" | grep -qE "FAIL|PAGEERROR|CONSOLE:|problem\(s\)|=== failures: [1-9]"; then
    red=$((red+1)); failing="$failing $f"
    echo "### $f (exit $code)"
    echo "$out" | grep -E "FAIL|PAGEERROR|CONSOLE:|problem\(s\)|failures:" | head -8
  else
    green=$((green+1))
  fi
done

kill $MOCK 2>/dev/null
echo
echo "green: $green   red: $red"
[ -n "$failing" ] && echo "failing:$failing"
[ $red -eq 0 ]
