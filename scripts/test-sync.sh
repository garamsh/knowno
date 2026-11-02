#!/usr/bin/env bash
# Runs the tests that need Auth and PostgREST, the two-device sync test
# app/test/sync/two_devices_test.dart, the sharing server test app/test/sharing/sharing_server_test.dart and the
# suspension test app/test/account/suspension_test.dart,
# against a local stack of its own, or says why it did not. The stack follows ADR 0014's pattern for the database tests: its own
# project id and reserved ports, stopped with its data however the run ends. It runs Postgres, Auth,
# PostgREST and the API gateway, which the test signs in and syncs through.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/skip.sh

test_files="test/sync/two_devices_test.dart test/sharing/sharing_server_test.dart test/account/suspension_test.dart"

if ! command -v docker >/dev/null 2>&1; then
  skip "the stack tests in app/ ($test_files): they need Docker, and this host has no docker command"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  skip "the stack tests in app/ ($test_files): they need Docker, and docker info reached no daemon on this host"
  exit 0
fi

stack="the sync test stack"
. scripts/test-stack.sh
reserve db_port 54400 54499 || exit 1
reserve api_port 54500 54599 || exit 1

export SUPABASE_PROJECT_ID="knowno_sync_$db_port" SUPABASE_DB_PORT="$db_port" SUPABASE_API_PORT="$api_port"

trap 'stop_stack $?' EXIT
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

# The two-device test runs the tombstone purge in the stack's database container.
output=$(cd app && KNOWNO_SYNC_TEST_URL="$url" KNOWNO_SYNC_TEST_KEY="$key" \
  KNOWNO_SYNC_TEST_DB_CONTAINER="supabase_db_$SUPABASE_PROJECT_ID" \
  flutter test --concurrency=1 --reporter expanded --dart-define-from-file=config/dev.json $test_files) ||
  { echo "$output"; exit 1; }
echo "$output"

# The last line reads "+<passed>: All tests passed!", with "~<skipped>" when any test skipped.
summary=$(echo "$output" | tail -n 1)
passed=$(echo "$summary" | sed -n 's/^[0-9:]* +\([0-9]*\): All tests passed!$/\1/p')
if [ -z "$passed" ] || [ "$passed" -eq 0 ]; then
  echo "the stack tests skipped or ran no test: $summary" >&2
  exit 1
fi
echo "ran $passed stack tests against the stack $SUPABASE_PROJECT_ID, selected by: every test in app/ $test_files"
