# Sourced by the scripts in scripts/ that skip a step when this host lacks the tool or the Docker
# daemon the step needs. Locally the step is skipped and says why. Where CI is set, the workflow was
# meant to install what the step needs, so the missing tool fails the step instead of skipping it.
# Usage: skip "<what did not run>: <why>"; the caller then exits 0 or carries on.
skip() {
	if [ -n "${CI:-}" ]; then
		echo "did not run $1; CI is set, and there a missing tool fails the step instead of skipping it" >&2
		exit 1
	fi
	echo "skipped $1"
}
