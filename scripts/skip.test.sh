#!/bin/sh
# Tests scripts/skip.sh: without CI a step is skipped, says so and lets the script carry on; with CI
# set the same call fails the script, so CI never reports a skipped step as a passed one.
set -euf

here=$(cd "$(dirname "$0")" && pwd)
passed=0

# The output and exit code of a script that calls skip and then carries on, in the environment $@.
run() {
	env "$@" sh -c ". '$here/skip.sh'; skip 'the probe: this host has no probe command'; echo carried on" 2>&1 &&
		echo "exit 0" || echo "exit $?"
}

# Fails unless the output $2 of case $1 is exactly $3.
expect() {
	if [ "$2" != "$3" ]; then
		printf 'FAIL %s: expected:\n%s\ngot:\n%s\n' "$1" "$3" "$2" >&2
		exit 1
	fi
	passed=$((passed + 1))
}

expect "without CI the step is skipped and the script carries on" "$(run -u CI)" \
	"skipped the probe: this host has no probe command
carried on
exit 0"
expect "with CI set the same step fails the script" "$(run CI=true)" \
	"did not run the probe: this host has no probe command; CI is set, and there a missing tool fails the step instead of skipping it
exit 1"

echo "passed $passed cases of scripts/skip.sh"
