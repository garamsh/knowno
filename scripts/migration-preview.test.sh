#!/usr/bin/env bash
# Tests scripts/migration-preview.sh, or says why it did not, in a repository it builds in a
# temporary directory: main holds this repository's supabase/ migrations and preview seed, and a
# merge commit, as CI checks a pull request out, adds a fixture migration and edits one of main's.
# It reads the report: the seed filling every table of public and private, each schema change
# and row count the fixture makes, a table it leaves alone as control, and the edited migration
# listed and not applied.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/skip.sh

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  skip "the migration preview test: it needs Docker, and docker reached no daemon on this host"
  exit 0
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/migration-preview-test.XXXXXX")
trap 'rm -rf "${work:?}"' EXIT
repo=$work/repo
git() { command git -C "$repo" -c user.name=t -c user.email=t@t "$@"; }

mkdir -p "$repo/supabase" "$repo/scripts"
cp -R supabase/config.toml supabase/seed.sql supabase/preview-seed.sql supabase/migrations \
  supabase/migration-preview.sql "$repo/supabase/"
cp scripts/test-stack.sh scripts/migration-preview.sh "$repo/scripts/"
git init -q -b main
git add -A
git commit -q -m main
first=$(ls "$repo/supabase/migrations" | sort | head -n 1)

git checkout -q -b branch
cat >"$repo/supabase/migrations/29991231000000_preview_fixture.sql" <<'SQL'
alter table public.decks add column archived boolean not null default false;
update public.study_settings set daily_minutes = daily_minutes + 5;
alter table public.media drop column sha256;
alter table public.reviews alter column duration_ms type bigint;
delete from public.user_blocks;
create table public.tags (id uuid primary key, name text not null);
insert into public.tags values (gen_random_uuid(), 'fixture');
drop table private.revision_marks;
SQL
echo "create table public.edited_probe (id int primary key); insert into public.edited_probe values (1);" >>"$repo/supabase/migrations/$first"
git add -A
git commit -q -m branch
git checkout -q main
git merge -q --no-ff -m merge branch

if ! log=$("$repo/scripts/migration-preview.sh" "$work/report" 2>&1); then
  echo "$log" | tail -n 20 >&2
  echo "the migration preview failed on the fixture repository" >&2
  exit 1
fi

check() {
  if ! jq -e "$2" "$work/report.json" >/dev/null; then
    echo "the migration preview's report fails: $1" >&2
    jq . "$work/report.json" >&2
    exit 1
  fi
}
table() { echo ".tables[] | select(.table == \"$1\")"; }

check "it applies main's migrations, loads main's preview seed and applies the one new migration" \
  ".seeded == \"main's supabase/preview-seed.sql\" and .new == [\"29991231000000_preview_fixture.sql\"]"
check "the preview seed puts rows in every table of public and private" \
  '[.tables[] | select((.table | test("^(public|private)\\.")) and .status != "added" and .rows_before == 0) | .table] == []'
check "the edited migration of main's is listed, and not applied" \
  ".edited == [\"$first\"] and ([.tables[] | select(.table == \"public.edited_probe\")] == [])"
check "an added column is a schema change, and its values change no row" \
  "$(table public.decks) | .columns == [{column: \"archived\", status: \"added\", before: null, after: \"boolean not null default false\"}] and .changed == 0"
check "an update counts each row it changed, and no row added or removed" \
  "$(table public.study_settings) | .rows_before > 0 and .changed == .rows_before and .added == 0 and .removed == 0"
check "a dropped column is listed with its definition before" \
  "$(table public.media) | .columns == [{column: \"sha256\", status: \"dropped\", before: \"text not null\", after: null}] and .changed == 0"
check "an altered column is listed with its definitions before and after" \
  "$(table public.reviews) | .columns == [{column: \"duration_ms\", status: \"altered\", before: \"integer not null\", after: \"bigint not null\"}]"
check "a delete counts each row removed" \
  "$(table public.user_blocks) | .rows_before > 0 and .removed == .rows_before and .rows_after == 0"
check "an added table is listed with its rows" \
  "$(table public.tags) | .status == \"added\" and .rows_after == 1"
check "a dropped table is listed with the rows it held" \
  "$(table private.revision_marks) | .status == \"dropped\" and .removed == .rows_before and .rows_before > 0"
check "a table the migration leaves alone reports no change" \
  "$(table public.cards) | .rows_before > 0 and .added + .removed + .changed == 0 and .columns == []"
grep -qxF '| `public.study_settings` | 2 | 2 | 0 | 0 | 2 |' "$work/report.md" ||
  { echo "the Markdown report does not list the updated table's counts" >&2; cat "$work/report.md" >&2; exit 1; }
grep -qxF -- '- `public.media`: `sha256` dropped, was `text not null`' "$work/report.md" ||
  { echo "the Markdown report does not list the dropped column" >&2; cat "$work/report.md" >&2; exit 1; }
echo "checked the migration preview on a merge adding a fixture migration over $(jq .main "$work/report.json") of main's: the seed in every table of public and private, a column added, dropped and altered, rows updated and deleted, a table added and dropped, $(jq -r '.tables | length' "$work/report.json") tables compared with public.cards unchanged as control, and the edited $first not applied"
