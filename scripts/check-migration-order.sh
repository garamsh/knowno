#!/bin/sh
# Fails when a migration this branch adds does not sort after every migration on main. Supabase's
# GitHub integration still runs such a migration on merge, out of order, and only warns
# (server.md), so production would apply it after the later ones it should have preceded.
#
# The base is main as the change will meet it: the first parent of a merge commit, which is how CI
# checks a pull request out, or else where HEAD left origin/main. A migration is new when the base
# has no file of its name; its version is the 14 digits its name starts with.
set -euf

cd "$(dirname "$0")/.."
dir=supabase/migrations

# The versions of the migration file names on stdin, one per line; a name of another shape is
# printed to stderr and fails the check.
versions() {
	while read -r name; do
		case "${name##*/}" in
		[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql)
			file=${name##*/}
			echo "${file%%_*}"
			;;
		*)
			echo "$name is not named <14-digit UTC time>_<name>.sql" >&2
			return 1
			;;
		esac
	done
}

# The versions on stdin that do not sort after $1: what the check refuses.
not_after() {
	awk -v latest="$1" '$0 <= latest'
}

if git rev-parse -q --verify 'HEAD^2' >/dev/null; then
	base=$(git rev-parse 'HEAD^1')
	how="the first parent of the merge commit HEAD"
elif git rev-parse -q --verify origin/main >/dev/null; then
	base=$(git merge-base HEAD origin/main)
	how="where HEAD left origin/main"
else
	echo "found no base to compare $dir/ with: HEAD is no merge commit and origin/main is unknown" >&2
	exit 1
fi

on_main=$(git ls-tree --name-only "$base" "$dir/" | sed -n 's#^.*/\([^/]*\.sql\)$#\1#p' | sort)
here=$(git ls-files --cached --others --exclude-standard -- "$dir/*.sql" | sed 's#^.*/##' | sort)
# The files here that main lacks, by name; with main empty, all of them.
if [ -n "$on_main" ]; then
	new=$(printf '%s\n' "$here" | grep -vxF -e "$on_main" || true)
else
	new=$here
fi
new_versions=$(printf '%s\n' "$new" | sed '/^$/d' | versions) || exit 1
latest=$(printf '%s\n' "$on_main" | sed '/^$/d' | versions | sort | tail -n 1)
early=$(printf '%s\n' "$new_versions" | sed '/^$/d' | not_after "${latest:-0}")
if [ -n "$early" ]; then
	echo "these new migrations do not sort after $latest, the latest on main at $base ($how):" >&2
	echo "$early" >&2
	echo "name each after the latest on main (server.md)" >&2
	exit 1
fi
count=$(printf '%s\n' "$new" | sed '/^$/d' | wc -l | tr -d ' ')
total=$(printf '%s\n' "$on_main" | sed '/^$/d' | wc -l | tr -d ' ')
echo "checked $count new migrations in $dir/, every file there that main lacks, against $latest, the latest of $total on main at $base ($how): each sorts after it"
