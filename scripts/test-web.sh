#!/usr/bin/env bash
# Runs every e2e spec in web/e2e/ against the built web app and a local stack of its own,
# or says why it did not. The stack follows ADR 0014's pattern for the database
# tests: its own project id and reserved ports, stopped with its data however the run ends. It
# runs Postgres, Auth, PostgREST and the API gateway; the app is built with the stack's URL and
# publishable key, which a build freezes, and served as the image serves it, by its standalone
# server.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/skip.sh

scope="git ls-files --cached --others --exclude-standard -- 'web/e2e/*.spec.ts'"
specs=$(eval "$scope" | sed 's|^web/||')
if [ -z "$specs" ]; then
  echo "no e2e spec was selected by: $scope" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  skip "the web e2e specs in web/e2e/: they need Docker, and this host has no docker command"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  skip "the web e2e specs in web/e2e/: they need Docker, and docker info reached no daemon on this host"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  skip "the web e2e specs in web/e2e/: this host has no node command"
  exit 0
fi

stack="the web e2e stack"
. scripts/test-stack.sh
reserve db_port 54400 54499 || exit 1
reserve api_port 54500 54599 || exit 1

export SUPABASE_PROJECT_ID="knowno_web_$db_port" SUPABASE_DB_PORT="$db_port" SUPABASE_API_PORT="$api_port"

server=""
stop() {
  local status=$?
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  rm -f "${server_log:-}"
  stop_stack "$status"
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Start applies the migrations. Its output and the status below carry the local keys, so neither
# is printed.
supabase start --exclude realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null
status=$(supabase status --output env)
url=$(echo "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
key=$(echo "$status" | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')
if [ -z "$url" ] || [ -z "$key" ]; then
  echo "supabase status gave no API_URL or PUBLISHABLE_KEY for the stack $SUPABASE_PROJECT_ID" >&2
  exit 1
fi

# The image copies the static files beside the standalone server; so does this run.
(cd web && NEXT_PUBLIC_SUPABASE_URL="$url" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$key" \
  NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null)
rm -rf web/.next/standalone/.next/static
cp -R web/.next/static web/.next/standalone/.next/static
rm -rf web/.next/standalone/public
cp -R web/public web/.next/standalone/public
server_log=$(mktemp)
# The server's port is reserved once the build is done, just before the server listens on it. The
# reservation sees only a listener, and a port can be held without one, as the local port of an
# outgoing connection, which Linux takes from 32768-60999 (#158). The server then exits with
# EADDRINUSE, and the next free port is reserved and tried, five times at most.
for attempt in 1 2 3 4 5; do
  reserve web_port 54600 54699 || exit 1
  PORT="$web_port" HOSTNAME=127.0.0.1 NODE_ENV=production node web/.next/standalone/server.js >"$server_log" 2>&1 &
  server=$!
  base="http://127.0.0.1:$web_port"
  tries=0
  until curl --silent --fail --output /dev/null "$base/api/health"; do
    if ! kill -0 "$server" 2>/dev/null; then
      break
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      cat "$server_log" >&2
      echo "the web app built for the stack did not answer $base/api/health within 60 s" >&2
      exit 1
    fi
    sleep 1
  done
  if kill -0 "$server" 2>/dev/null; then
    break
  fi
  wait "$server" 2>/dev/null || true
  server=""
  if ! grep -q EADDRINUSE "$server_log" || [ "$attempt" -eq 5 ]; then
    cat "$server_log" >&2
    echo "the web app built for the stack exited before answering on port $web_port, attempt $attempt" >&2
    exit 1
  fi
  echo "port $web_port was taken after it was reserved; trying the next free port"
done
echo "the web app answers on port $web_port"

output=$(cd web && npx playwright install chromium >/dev/null &&
  E2E_BASE_URL="$base" E2E_SUPABASE_URL="$url" E2E_SUPABASE_KEY="$key" \
    npx playwright test 2>&1) || { echo "$output"; echo "the web app's log:"; cat "$server_log"; exit 1; }
echo "$output"

# Playwright's list reporter ends with "<n> passed", and names any skipped test "<n> skipped".
passed=$(echo "$output" | sed -n 's/^ *\([0-9]*\) passed.*$/\1/p' | tail -n 1)
if [ -z "$passed" ] || [ "$passed" -eq 0 ] || echo "$output" | grep -qE '^ *[0-9]+ skipped'; then
  echo "the web e2e specs skipped or ran no test against the stack $SUPABASE_PROJECT_ID" >&2
  exit 1
fi
# A passed test's line reads "✓ <n> [<project>] › e2e/<file>.spec.ts:<line>:<col> › <title>";
# each selected spec must have one.
ran=$(echo "$output" | sed -n 's/^ *✓ *[0-9]* \[[^]]*\] › \(e2e\/[^:]*\.spec\.ts\):.*$/\1/p' | sort -u)
missed=$(comm -23 <(echo "$specs" | sort) <(echo "$ran"))
if [ -n "$missed" ]; then
  echo "these e2e specs ran no test against the stack $SUPABASE_PROJECT_ID:" >&2
  echo "$missed" >&2
  exit 1
fi
echo "ran $passed web e2e tests in $(echo "$specs" | wc -l | tr -d ' ') specs against the web app built for the stack $SUPABASE_PROJECT_ID, selected by: $scope"
