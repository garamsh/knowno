#!/bin/sh
# Runs a Deno program of scripts/ under its permissions, the narrowest it works with (ADR 0146).
# Where deno is not installed it skips the program and says why, or fails where CI is set (skip.sh).
# Usage: scripts/run.sh <program> [arguments]
set -euf

cd "$(dirname "$0")/.."
. scripts/skip.sh

program=${1:-}
what="scripts/$program.ts ${2:-}"
# The temporary directory by its real path, which is how Deno compares a grant.
TMPDIR=$(cd "${TMPDIR:-/tmp}" && pwd -P)
export TMPDIR
case "$program" in
check-ios-client-id) allow="--allow-read=app/config/dev.json,app/ios/Runner/Info.plist" ;;
check-migration-order) allow="--allow-run=git" ;;
check-secrets) allow="--allow-run=git --allow-read=." ;;
deno)
	allow="--allow-run=git,deno --allow-read=$TMPDIR --allow-write=$TMPDIR"
	what="deno ${2:-} over supabase/functions/ and tools/eval/"
	;;
*)
	echo "usage: $0 <program> [arguments]; no program is named ${program:-here}" >&2
	exit 2
	;;
esac

if ! command -v deno >/dev/null 2>&1; then
	skip "$what: this host has no deno command"
	exit 0
fi
shift
# shellcheck disable=SC2086 # the grants are separate flags
exec deno run --no-prompt $allow "scripts/$program.ts" "$@"
