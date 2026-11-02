#!/bin/sh
# Runs a Deno program of scripts/ under its grant in scripts/grants.txt (ADR 0146). Where deno is not
# installed it skips the program and says why, or fails where CI is set (skip.sh).
# Usage: scripts/run.sh <program> [arguments]
set -euf

cd "$(dirname "$0")/.."
. scripts/skip.sh

program=${1:-}
# The temporary directory by its real path, which is how Deno compares a grant.
TMPDIR=$(cd "${TMPDIR:-/tmp}" && pwd -P)
export TMPDIR
allow=$(sed -n "s|^$program: ||p" scripts/grants.txt | sed "s|TMPDIR|$TMPDIR|g")
if [ -z "$allow" ]; then
	echo "usage: $0 <program> [arguments]; no program is named ${program:-here}" >&2
	exit 2
fi

if ! command -v deno >/dev/null 2>&1; then
	what="scripts/$program.ts${2:+ $2}"
	[ "$program" != deno ] || what="deno ${2:-} over supabase/functions/ and tools/eval/"
	skip "$what: this host has no deno command"
	exit 0
fi
shift
# shellcheck disable=SC2086 # the grants are separate flags
exec deno run --quiet --no-prompt $allow "scripts/$program.ts" "$@"
