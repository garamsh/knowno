#!/bin/sh
# Runs make lint, format, test or build over the Next.js app in web/. Where node is not
# installed it skips the step and says why, or fails where CI is set (skip.sh). It installs web/'s
# locked packages when they are missing or older than web/package-lock.json, and builds with the public
# Supabase values of app/config/dev.json unless NEXT_PUBLIC_SUPABASE_* are already set.
# Where Docker answers, test runs the e2e specs against the image and build builds it.
set -euf

cd "$(dirname "$0")/.."
. scripts/skip.sh

# Every source file under web/ that git tracks or would track; ignored output such as
# node_modules/ and .next/ stays out. Printed beside each count so the coverage reads true.
scope="git ls-files --cached --others --exclude-standard -- 'web/*.ts' 'web/*.tsx' 'web/*.mjs'"
format_scope="git ls-files --cached --others --exclude-standard -- 'web/*.ts' 'web/*.tsx' 'web/*.mjs' 'web/*.json' 'web/*.css' ':!web/package-lock.json'"
# Vercel-only code: an @vercel/ package, or a route on the edge runtime (docs/architecture/web.md).
portability="@vercel/|runtime[[:space:]]*=[[:space:]]*[\"']edge[\"']"
image=knowno-web:local

if ! command -v node >/dev/null 2>&1; then
	skip "web $1 over web/: this host has no node command"
	exit 0
fi
want=$(cat web/.nvmrc)
have=$(node --version | sed 's/^v//')
if [ "$have" != "$want" ]; then
	echo "web/ runs on Node $want (web/.nvmrc); this host's node is $have" >&2
	exit 1
fi

if [ ! web/node_modules/.package-lock.json -nt web/package-lock.json ]; then
	(cd web && npm ci --no-audit --no-fund)
fi

NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-$(jq -r .SUPABASE_URL app/config/dev.json)}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-$(jq -r .SUPABASE_PUBLISHABLE_KEY app/config/dev.json)}
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_TELEMETRY_DISABLED=1

docker_answers() {
	docker info >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1
}

# Builds the image quietly; on a failure it prints the build's whole log, so the failing step's
# own error, such as next build's, reaches the output and CI's log rather than its exit code alone.
build_image() {
	log=$(mktemp)
	if ! docker build --progress=plain -f web/Dockerfile -t "$image" \
		--build-arg NEXT_PUBLIC_SUPABASE_URL --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY . >"$log" 2>&1; then
		cat "$log" >&2
		rm -f "$log"
		echo "the image build from web/Dockerfile failed; its log is above" >&2
		exit 1
	fi
	rm -f "$log"
}

files() {
	selected=$(eval "$1")
	if [ -z "$selected" ]; then
		echo "no file was selected by: $1" >&2
		exit 1
	fi
	# Relative to web/, where the tools run.
	echo "$selected" | sed 's|^web/||'
}

case "$1" in
lint)
	sources=$(files "$scope")
	# shellcheck disable=SC2086 # one path per line, none with spaces
	# next typegen writes the route types (PageProps, LayoutProps) both read, as next build would.
	(cd web && npx next typegen >/dev/null && npx eslint --max-warnings 0 $sources && npx tsc --noEmit)
	echo "linted $(echo "$sources" | wc -l | tr -d ' ') files with eslint, type rules included, selected by: $scope; type-checked web/tsconfig.json"

	# The control: the pattern finds each kind of Vercel-only line, so a clean result below means none.
	control=$(printf '%s\n' "import { kv } from '@vercel/kv';" 'export const runtime = "edge";' "export const runtime = 'nodejs';")
	if [ "$(echo "$control" | grep -cE "$portability")" -ne 2 ]; then
		echo "the portability pattern no longer finds both control lines: $portability" >&2
		exit 1
	fi
	if git grep --untracked -nE "$portability" -- web; then
		echo "web/ holds Vercel-only code (an @vercel/ package or the edge runtime): docs/architecture/web.md" >&2
		exit 1
	fi
	echo "found no @vercel/ package and no edge runtime in web/ (git grep --untracked over web/), and the pattern found both control lines"

	froms=$(grep -c '^FROM ' web/Dockerfile)
	if [ "$(grep -c "^FROM node:$want-" web/Dockerfile)" -ne "$froms" ]; then
		echo "every FROM in web/Dockerfile must be node:$want-..., the release web/.nvmrc names" >&2
		exit 1
	fi
	echo "checked that the $froms FROM lines of web/Dockerfile run Node $want, as web/.nvmrc does"

	node tools/brand/generate.mjs --check
	;;
format)
	sources=$(files "$format_scope")
	# shellcheck disable=SC2086
	(cd web && npx prettier --check --log-level warn $sources)
	echo "format checked $(echo "$sources" | wc -l | tr -d ' ') files with prettier, selected by: $format_scope"
	;;
test)
	(cd web && npx vitest run)
	echo "ran the tests vitest selects in web/: src/**/__tests__/*.test.{ts,tsx}"
	if ! docker_answers; then
		skip "the e2e specs in web/e2e/: they run against the image, and docker or docker buildx does not answer"
		exit 0
	fi
	build_image
	container=$(docker run --detach --rm --publish 127.0.0.1::3000 "$image")
	trap 'docker stop "$container" >/dev/null' EXIT
	url="http://$(docker port "$container" 3000/tcp | head -n 1)"
	tries=0
	until curl --silent --fail --output /dev/null "$url/api/health"; do
		tries=$((tries + 1))
		if [ "$tries" -gt 60 ]; then
			docker logs "$container" >&2
			echo "the image did not answer $url/api/health within 60 s" >&2
			exit 1
		fi
		sleep 1
	done
	uid=$(docker exec "$container" id -u)
	if [ "$uid" -eq 0 ]; then
		echo "the image runs as root" >&2
		exit 1
	fi
	echo "the image $image answers $url/api/health and runs as uid $uid"
	(cd web && npx playwright install chromium >/dev/null && E2E_BASE_URL="$url" npx playwright test)
	echo "ran the e2e specs Playwright selects in web/e2e/ against the image; web/e2e/study.spec.ts skips there; scripts/test-web.sh runs every spec against a local stack"
	;;
build)
	(cd web && npx next build)
	echo "built web/ with next build into web/.next/standalone/"
	if docker_answers; then
		build_image
		echo "built the image $image from web/Dockerfile"
	else
		skip "the image build: docker or docker buildx does not answer"
	fi
	;;
*)
	echo "usage: $0 lint|format|test|build" >&2
	exit 2
	;;
esac
