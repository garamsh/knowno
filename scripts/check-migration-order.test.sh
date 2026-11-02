#!/bin/sh
# Tests scripts/check-migration-order.sh on repositories it builds in a temporary directory: a pull
# request's merge commit as CI checks it out (a clone two commits deep), and a branch beside
# origin/main as a contributor runs it. Each refusal is read beside the case it accepts.
set -euf

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/check-migration-order.XXXXXX")
trap 'rm -rf "${work:?}"' EXIT
passed=0

# A repository at $work/$1 whose main holds the migrations named in $2, and the check.
main_with() {
	repo=$work/$1
	git init -q -b main "$repo"
	mkdir -p "$repo/supabase/migrations" "$repo/scripts"
	cp "$here/check-migration-order.sh" "$repo/scripts/"
	for name in $2; do echo "select 1;" >"$repo/supabase/migrations/$name"; done
	git -C "$repo" add -A
	git -C "$repo" -c user.name=t -c user.email=t@t commit -q -m main
}

# Adds the migrations named in $2 on a branch of $1 and commits them.
branch_adds() {
	git -C "$work/$1" checkout -q -b branch main
	for name in $2; do echo "select 1;" >"$work/$1/supabase/migrations/$name"; done
	git -C "$work/$1" add -A
	git -C "$work/$1" -c user.name=t -c user.email=t@t commit -q -m branch
}

# The check's exit code and output in a clone of $1 two commits deep at a merge of the branch into
# main, as CI's checkout leaves a pull request.
as_ci() {
	git -C "$work/$1" checkout -q main
	git -C "$work/$1" -c user.name=t -c user.email=t@t merge -q --no-ff -m merge branch
	git clone -q --depth 2 "file://$work/$1" "$work/$1-ci"
	git -C "$work/$1-ci" rev-parse -q --verify 'HEAD^2' >/dev/null || {
		echo "setup: the clone of $1 lacks the merge commit's second parent" >&2
		exit 1
	}
	git -C "$work/$1-ci" remote remove origin
	(cd "$work/$1-ci" && ./scripts/check-migration-order.sh 2>&1) && echo "exit 0" || echo "exit $?"
}

# The check's exit code and output on the branch of $1, beside an origin/main at main.
as_contributor() {
	git -C "$work/$1" update-ref refs/remotes/origin/main main
	(cd "$work/$1" && ./scripts/check-migration-order.sh 2>&1) && echo "exit 0" || echo "exit $?"
}

# Fails unless the output $2 of case $1 ends in exit $3 and holds the line $4.
expect() {
	case "$2" in
	*"exit $3") ;;
	*)
		printf 'FAIL %s: expected exit %s, got:\n%s\n' "$1" "$3" "$2" >&2
		exit 1
		;;
	esac
	if ! printf '%s\n' "$2" | grep -qxF -- "$4"; then
		printf 'FAIL %s: expected the line "%s" in:\n%s\n' "$1" "$4" "$2" >&2
		exit 1
	fi
	passed=$((passed + 1))
}

# Fails when the output $2 of case $1 holds the line $3.
expect_not() {
	if printf '%s\n' "$2" | grep -qxF -- "$3"; then
		printf 'FAIL %s: did not expect the line "%s" in:\n%s\n' "$1" "$3" "$2" >&2
		exit 1
	fi
	passed=$((passed + 1))
}

on_main="20261017120000_a.sql 20261018090000_b.sql"

main_with later "$on_main"
branch_adds later "20261018090001_next.sql"
expect "a migration one second after main's latest, ahead of the clock as it is" \
	"$(as_ci later)" 0 "checked 1 new migrations in supabase/migrations/, every file there that main lacks, against 20261018090000, the latest of 2 on main at $(git -C "$work/later" rev-parse main~1) (the first parent of the merge commit HEAD): each sorts after it"

main_with earlier "$on_main"
branch_adds earlier "20261018090001_next.sql 20261017200000_early.sql"
out=$(as_ci earlier)
expect "a migration made after main's latest was merged but named before it" "$out" 1 "20261017200000"
expect_not "beside it, one named after main's latest" "$out" "20261018090001"

main_with equal "$on_main"
branch_adds equal "20261018090000_same.sql"
expect "a migration of main's latest version under another name" "$(as_ci equal)" 1 "20261018090000"

main_with moved "$on_main"
branch_adds moved "20261018090001_next.sql"
git -C "$work/moved" checkout -q main
echo "select 1;" >"$work/moved/supabase/migrations/20261018090002_merged.sql"
git -C "$work/moved" add -A
git -C "$work/moved" -c user.name=t -c user.email=t@t commit -q -m "main moves"
expect "a migration main has since passed, beside the branch's own base it sorts after" \
	"$(git -C "$work/moved" checkout -q branch && as_contributor moved)" 0 "checked 1 new migrations in supabase/migrations/, every file there that main lacks, against 20261018090000, the latest of 2 on main at $(git -C "$work/moved" rev-parse main~1) (where HEAD left origin/main): each sorts after it"
expect "the same migration in the pull request's merge with main as it now is" "$(as_ci moved)" 1 "20261018090001"

main_with named "$on_main"
branch_adds named "20261018_short.sql"
expect "a migration whose name does not start with 14 digits" "$(as_ci named)" 1 "20261018_short.sql is not named <14-digit UTC time>_<name>.sql"

main_with pushed "$on_main"
expect "main itself, after a merge, with nothing new" "$(as_contributor pushed)" 0 "checked 0 new migrations in supabase/migrations/, every file there that main lacks, against 20261018090000, the latest of 2 on main at $(git -C "$work/pushed" rev-parse main) (where HEAD left origin/main): each sorts after it"

echo "passed $passed cases of scripts/check-migration-order.sh, each in a repository this script builds"
