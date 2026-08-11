#!/usr/bin/env bash
# Build the examples, serve the repo root, and open the demo in a browser.
#
#   ./dev.sh                 # build, serve on :8000, open the app
#   ./dev.sh --port 9000     # use another port
#   ./dev.sh --check         # headless: run the browser smoke test, print PASS/FAIL, exit
#   ./dev.sh --no-open       # serve only, don't launch a browser
#
# Ctrl-C stops the server.
set -euo pipefail
cd "$(dirname "$0")"

PORT=8000
OPEN=1
CHECK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --check) CHECK=1; OPEN=0; shift ;;
    --no-open) OPEN=0; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# 1. Compile every example component to build/. The directory is cleared first
# so a renamed or deleted source cannot leave a stale module behind — the entry
# point search would happily load it.
echo "==> compiling examples"
rm -rf build
# Individual modules, for tests and for debugging one component at a time.
cargo run --quiet -- examples --outdir build --runtime ../mosaic.js
# ...and the single payload the app actually loads, with its source map.
cargo run --quiet -- examples --bundle build/app.js --runtime ../mosaic.js

# 2. Serve the repo root: the pages import ../mosaic.js, which file:// forbids.
if command -v python3 >/dev/null; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
else
  echo "need python3 to serve" >&2
  exit 1
fi
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

BASE="http://127.0.0.1:$PORT/examples/"
# examples/index.html is the app entry point: MosaicApplication loads
# build/main.js and mounts it.
URL="$BASE"

for _ in $(seq 1 50); do
  curl -sf -o /dev/null "$URL" && break
  sleep 0.1
done

# 3a. --check: run the smoke test headlessly and exit with its status.
if [ "$CHECK" = 1 ]; then
  BROWSER=""
  for b in chromium chromium-browser google-chrome brave; do
    command -v "$b" >/dev/null && BROWSER="$b" && break
  done
  [ -n "$BROWSER" ] || { echo "no chromium-like browser found" >&2; exit 1; }

  OUT=$("$BROWSER" --headless --no-sandbox --disable-gpu --virtual-time-budget=5000 \
        --dump-dom "${BASE}browser-check.html" 2>/dev/null)

  # Read the verdict from the rendered <title>, not from anywhere in the dump:
  # the page's own script source is part of the DOM, so matching the whole
  # document would find the literal "PASS" it assigns and always succeed.
  # The results block spans lines, so slice between its tags and strip markup.
  printf '%s\n' "$OUT" \
    | sed -n '/<pre id="results">/,/<\/pre>/p' \
    | sed -e 's|<pre id="results">||' -e 's|</pre>||' \
    | grep -E "^(PASS|FAIL|ERROR)" || true
  TITLE=$(printf '%s\n' "$OUT" | sed -n 's|.*<title>\(.*\)</title>.*|\1|p' | head -1)

  case "$TITLE" in
    *"verdict PASS"*)
      echo "==> browser check PASSED"
      exit 0
      ;;
    *"verdict FAIL"*)
      echo "==> browser check FAILED: $TITLE" >&2
      exit 1
      ;;
    *)
      echo "==> browser check did not finish (title: ${TITLE:-none})" >&2
      echo "    the page threw before reporting; open ${BASE}browser-check.html" >&2
      exit 1
      ;;
  esac
fi

# 3b. Otherwise open the demo and keep serving.
echo "==> serving $URL"
echo "    app:   $URL"
echo "    check: ${BASE}browser-check.html"
echo "    Ctrl-C to stop"

if [ "$OPEN" = 1 ]; then
  if command -v xdg-open >/dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 &
  else
    for b in chromium chromium-browser google-chrome brave firefox; do
      command -v "$b" >/dev/null && "$b" "$URL" >/dev/null 2>&1 & break
    done
  fi
fi

wait $SERVER
