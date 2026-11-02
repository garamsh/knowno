#!/bin/sh
# Generates engine-wasm/pkg/ or runs engine-wasm/'s tests as WebAssembly, as
# scripts/check-generated.sh and make test ask. Both need the wasm-bindgen CLI at the release
# engine-wasm/Cargo.lock pins; the tests also need node. Where either is missing it skips the step
# and says why, or fails where CI is set (skip.sh).
set -euf

cd "$(dirname "$0")/.."
. scripts/skip.sh
root=$(pwd)

if ! command -v wasm-bindgen >/dev/null 2>&1; then
	skip "wasm-bindgen ${1:-} in engine-wasm/: this host has no wasm-bindgen command"
	exit 0
fi
version=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' engine-wasm/Cargo.lock)
if [ "$(wasm-bindgen --version)" != "wasm-bindgen $version" ]; then
	echo "wasm-bindgen $version is required, as engine-wasm/Cargo.lock pins; found: $(wasm-bindgen --version)" >&2
	exit 1
fi

cd engine-wasm

case "${1:-}" in
generate)
	# Absolute paths reach the module in panic locations; mapping them makes it the same on every host.
	cargo_home=${CARGO_HOME:-$HOME/.cargo}
	RUSTFLAGS="--remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$root=/knowno" \
		cargo build --locked --release --target-dir target/generate
	wasm-bindgen --target web --out-dir pkg target/generate/wasm32-unknown-unknown/release/knowno_engine_wasm.wasm
	echo "generated engine-wasm/pkg/ with wasm-bindgen $version, --target web"
	;;
test)
	if ! command -v node >/dev/null 2>&1; then
		skip "the WebAssembly tests in engine-wasm/: this host has no node command, which wasm-bindgen-test-runner runs them in"
		exit 0
	fi
	output=$(cargo test --locked -- --nocapture 2>&1) || { echo "$output"; exit 1; }
	echo "$output"
	passed=$(echo "$output" | sed -n 's/^test result: ok\. \([0-9]*\) passed.*/\1/p' | awk '{ sum += $1 } END { print sum + 0 }')
	if [ "$passed" -eq 0 ]; then
		echo "cargo test ran no test in engine-wasm/" >&2
		exit 1
	fi
	echo "ran $passed tests as WebAssembly in node, the tests cargo test selects by default in engine-wasm/: engine-wasm/tests/*.rs, unit and doc tests"
	;;
*)
	echo "usage: $0 generate|test" >&2
	exit 2
	;;
esac
