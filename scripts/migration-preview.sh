#!/usr/bin/env bash
# Previews what this branch's migrations do to a database holding data: on a throwaway local stack,
# applies main's migrations, loads main's supabase/preview-seed.sql, applies the migrations this
# branch adds, and writes the tables and columns added, dropped or altered and the rows added,
# removed and changed per table: <out>.json as supabase/migration-preview.sql reports it, and
# <out>.md for the pull request. The stack is stopped, with its data, however the run ends
# (ADR 0014). Production data never reaches it (server.md).
#
# The base is main as the change will meet it, as scripts/check-migration-order.sh reads it: the first
# parent of a merge commit, which is how CI checks a pull request out, or else where HEAD left
# origin/main.
#
# Usage: scripts/migration-preview.sh <out path, without extension>
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <report path, without extension>" >&2
  exit 2
fi
out=$1
dir=supabase/migrations

if git rev-parse -q --verify 'HEAD^2' >/dev/null; then
  base=$(git rev-parse 'HEAD^1')
  how="the first parent of the merge commit HEAD"
elif git rev-parse -q --verify origin/main >/dev/null; then
  base=$(git merge-base HEAD origin/main)
  how="where HEAD left origin/main"
else
  echo "found no base to preview $dir/ against: HEAD is no merge commit and origin/main is unknown" >&2
  exit 1
fi

on_main=$(git ls-tree --name-only "$base" "$dir/" | sed -n 's#^.*/\([^/]*\.sql\)$#\1#p' | sort)
here=$(git ls-files --cached --others --exclude-standard -- "$dir/*.sql" | sed 's#^.*/##' | sort)
new=$(comm -13 <(printf '%s\n' "$on_main" | sed '/^$/d') <(printf '%s\n' "$here" | sed '/^$/d'))
# A migration main has that this branch changed: the integration applies none it already applied.
edited=$(comm -12 <(printf '%s\n' "$on_main" | sed '/^$/d') <(printf '%s\n' "$here" | sed '/^$/d') |
  while read -r name; do
    git diff --quiet "$base" -- "$dir/$name" || echo "$name"
  done)

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "the migration preview needs Docker, and docker reached no daemon on this host" >&2
  exit 1
fi

stack="the migration preview stack"
. scripts/test-stack.sh
reserve port 54400 54499 || exit 1
export SUPABASE_PROJECT_ID="knowno_preview_$port" SUPABASE_DB_PORT="$port"
work=$(mktemp -d "${TMPDIR:-/tmp}/migration-preview.XXXXXX")
trap 'status=$?; rm -rf "${work:?}"; stop_stack "$status"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# main's supabase/ as the stack's project: its config and migrations, and its empty seed.sql.
git archive "$base" supabase/config.toml supabase/seed.sql "$dir" | tar -x -C "$work"
seeded="main's supabase/preview-seed.sql"
if ! git show "$base:supabase/preview-seed.sql" >"$work/preview-seed.sql" 2>/dev/null; then
  : >"$work/preview-seed.sql"
  seeded="no rows: main has no supabase/preview-seed.sql"
fi

supabase start --workdir "$work" --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null
sql() { docker exec -i "supabase_db_$SUPABASE_PROJECT_ID" psql -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1; }
sql <"$work/preview-seed.sql"
sql <supabase/migration-preview.sql
echo 'select migration_preview.snapshot();' | sql >/dev/null

for name in $new; do cp "$dir/$name" "$work/$dir/"; done
supabase migration up --local --workdir "$work" >/dev/null

echo 'select migration_preview.report();' | sql |
  jq --arg base "$base" --arg how "$how" --arg seeded "$seeded" \
    --argjson main "$(printf '%s\n' "$on_main" | sed '/^$/d' | jq -R . | jq -s .)" \
    --argjson new "$(printf '%s\n' "$new" | sed '/^$/d' | jq -R . | jq -s .)" \
    --argjson edited "$(printf '%s\n' "$edited" | sed '/^$/d' | jq -R . | jq -s .)" \
    '. + {base: $base, how: $how, seeded: $seeded, main: ($main | length), new: $new, edited: $edited}' >"$out.json"

jq -r '
  def moved: .status != "kept" or .added + .removed + .changed > 0;
  def col: "`\(.column)` \(.status)" + (if .status == "added" then " as `\(.after)`"
    elif .status == "dropped" then ", was `\(.before)`" else ": `\(.before)` to `\(.after)`" end);
  [
    "# Migration preview",
    "",
    "Applied main'"'"'s \(.main) migrations at `\(.base)` (\(.how)), loaded \(.seeded), then applied the \(.new | length) migrations this branch adds:",
    "",
    (if (.new | length) == 0 then "- None." else (.new | map("- `\(.)`") | join("\n")) end),
    "",
    (if (.edited | length) > 0 then
      "These migrations main has were changed here and not applied again, as production would not apply them again:\n\n"
      + (.edited | map("- `\(.)`") | join("\n")) + "\n" else empty end),
    "## Schema changes",
    "",
    ([.tables[] | select(.status != "kept" or (.columns | length) > 0) |
      if .status == "kept" then "- `\(.table)`: " + (.columns | map(col) | join("; "))
      else "- `\(.table)` \(.status)" end] | if length == 0 then "None." else join("\n") end),
    "",
    "## Rows changed per table",
    "",
    "Rows are compared on the columns a table had before and still has, by its primary key; a value in an added column is not counted.",
    "",
    ([.tables[] | select(moved)] | if length == 0 then "None." else
      (["| Table | Rows before | Rows after | Added | Removed | Changed |", "|---|---|---|---|---|---|"]
       + map("| `\(.table)` | \(.rows_before) | \(.rows_after) | \(.added) | \(.removed) | \(.changed) |")
       | join("\n")) end),
    "",
    "Compared \(.tables | length) tables in the schemas \(.schemas | join(", ")): every table there before or after; \([.tables[] | select(moved | not)] | length) had no row added, removed or changed."
  ] | join("\n")
' "$out.json" >"$out.md"

echo "wrote $out.json and $out.md: $(echo "$new" | sed '/^$/d' | wc -l | tr -d ' ') new migrations applied over main's $(echo "$on_main" | sed '/^$/d' | wc -l | tr -d ' ') at $base ($how), $(jq '[.tables[] | select(.status != "kept" or .added + .removed + .changed > 0)] | length' "$out.json") of $(jq '.tables | length' "$out.json") tables with rows or the table changed"
