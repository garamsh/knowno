#!/bin/sh
# Runs deno lint, format or test, as make lint, format and test ask, over the TypeScript of the
# Edge Functions in supabase/functions/ and the eval in tools/eval/. Where deno is not
# installed it skips the step and says why, or fails where CI is set (skip.sh). The tests run with read access to
# tools/eval/ and to the prompt files' copies in SQL, the store's seed, v9's activation and its
# pgTAP test, which one test compares with the prompt files, only: no write, network or environment access, so a test that writes fails. A
# *_io_test.ts file runs apart, writing only under a temporary directory this script removes,
# and running deno, so it can run the eval as a subprocess under the eval's own grant.
set -euf

scope="git ls-files --cached --others --exclude-standard -- 'supabase/functions/*.ts' 'tools/eval/*.ts'"

cd "$(dirname "$0")/.."
. scripts/skip.sh

if ! command -v deno >/dev/null 2>&1; then
	skip "deno $1 over supabase/functions/ and tools/eval/: this host has no deno command"
	exit 0
fi

files=$(eval "$scope")
if [ -z "$files" ]; then
	echo "no TypeScript file was selected by: $scope" >&2
	exit 1
fi
count=$(echo "$files" | wc -l | tr -d ' ')

case "$1" in
lint)
	# shellcheck disable=SC2086 # one path per line, none with spaces
	deno lint $files
	# shellcheck disable=SC2086
	deno check --quiet $files
	echo "linted and type-checked $count TypeScript files, selected by: $scope"
	;;
format)
	# shellcheck disable=SC2086
	deno fmt --check $files
	echo "format checked $count TypeScript files, selected by: $scope"
	;;
test)
	tests=$(echo "$files" | grep '_test\.ts$' | grep -v '_io_test\.ts$' || true)
	io_tests=$(echo "$files" | grep '_io_test\.ts$' || true)
	if [ -z "$tests" ]; then
		echo "no *_test.ts file was selected by: $scope" >&2
		exit 1
	fi
	# shellcheck disable=SC2086
	output=$(NO_COLOR=1 deno test --no-prompt --allow-read=tools/eval,supabase/migrations/20261019210000_prompts.sql,supabase/migrations/20261019230003_activate_prompt_v9.sql,supabase/tests/prompt_v9_activation_test.sql $tests 2>&1) || { echo "$output"; exit 1; }
	echo "$output"
	passed=$(echo "$output" | sed -n 's/.*ok | \([0-9]*\) passed.*/\1/p' | tail -n 1)
	if [ -z "$passed" ] || [ "$passed" -eq 0 ]; then
		echo "deno test ran no test" >&2
		exit 1
	fi
	ran=$(echo "$tests" | wc -l | tr -d ' ')
	if [ -n "$io_tests" ]; then
		tmp=$(mktemp -d)
		trap 'rm -rf "$tmp"' EXIT
		# shellcheck disable=SC2086
		output=$(NO_COLOR=1 TMPDIR="$tmp" deno test --no-prompt --allow-read=tools/eval,"$tmp" --allow-write="$tmp" --allow-run=deno $io_tests 2>&1) || { echo "$output"; exit 1; }
		echo "$output"
		io_passed=$(echo "$output" | sed -n 's/.*ok | \([0-9]*\) passed.*/\1/p' | tail -n 1)
		if [ -z "$io_passed" ] || [ "$io_passed" -eq 0 ]; then
			echo "deno test ran no *_io_test.ts test" >&2
			exit 1
		fi
		passed=$((passed + io_passed))
		ran=$((ran + $(echo "$io_tests" | wc -l | tr -d ' ')))
	fi
	echo "ran $passed Deno tests in $ran files, selected as the *_test.ts files among: $scope"
	;;
*)
	echo "usage: $0 lint|format|test" >&2
	exit 2
	;;
esac
