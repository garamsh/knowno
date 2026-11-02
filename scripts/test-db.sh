#!/usr/bin/env bash
# Runs the pgTAP tests in supabase/tests/ against a local stack of its own, or says why it did not.
# The stack gets its own project id and database port, so concurrent runs and the shared
# knowno stack never meet; it is stopped, with its data, however the run ends.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/skip.sh

if ! command -v docker >/dev/null 2>&1; then
  skip "the database tests in supabase/tests/: they need Docker, and this host has no docker command"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  skip "the database tests in supabase/tests/: they need Docker, and docker info reached no daemon on this host"
  exit 0
fi

stack="the test stack"
. scripts/test-stack.sh
reserve port 54400 54499 || exit 1

export SUPABASE_PROJECT_ID="knowno_test_$port" SUPABASE_DB_PORT="$port"

trap 'stop_stack $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The tests need only Postgres. Start applies the migrations; its output, which carries the local
# keys, is not printed.
supabase start --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null
# `supabase test db` mounts supabase/tests/ alone, so the dry run's file reaches its test,
# card_frame_dry_run_test.sql, and the frame's fixtures card_frame_migration_test.sql, as database
# settings each test's session reads.
docker exec -i "supabase_db_$SUPABASE_PROJECT_ID" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 \
  -v query="$(cat supabase/card-frame-dry-run.sql)" \
  -v fixtures="$(cat supabase/fixtures/card-frame/conversion.json)" <<'SQL'
alter database postgres set knowno.card_frame_dry_run = :'query';
alter database postgres set knowno.card_frame_fixtures = :'fixtures';
SQL
output=$(supabase test db --local) || { echo "$output"; exit 1; }
echo "$output"

tests=$(echo "$output" | sed -n 's/^Files=\([0-9]*\), Tests=\([0-9]*\),.*/\2 \1/p')
if [ -z "$tests" ] || [ "${tests%% *}" -eq 0 ]; then
  echo "supabase test db ran no pgTAP test" >&2
  exit 1
fi
echo "ran ${tests%% *} pgTAP tests in ${tests##* } files against the stack $SUPABASE_PROJECT_ID, selected by supabase test db: every file under supabase/tests/"
