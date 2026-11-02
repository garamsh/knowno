.PHONY: lint format test build ci lint-repo lint-code bridge test-app test-db test-sync test-web build-ios build-apk build-engine-web preview-migrations brand

# lint and test are each the sum of their parts, run in this order. CI runs the parts as parallel
# jobs; lint-repo reads only the repository's files and needs no toolchain, so CI runs it on every
# pull request, one touching only docs/ or *.md files included.

# Every Dart file under app/ that git tracks or would track; ignored output such as
# build/ and .dart_tool/ stays out. Printed beside each count so the coverage reads true.
DART_SCOPE := git ls-files --cached --others --exclude-standard -- '*.dart'
DART_FILES = files=$$($(DART_SCOPE)); \
	if [ -z "$$files" ]; then echo "no Dart file was selected by: $(DART_SCOPE)" >&2; exit 1; fi

# The same selection for Rust files under each crate; target/ is ignored output.
RUST_SCOPE := git ls-files --cached --others --exclude-standard -- '*.rs'
RUST_FILES = files=$$($(RUST_SCOPE)); \
	if [ -z "$$files" ]; then echo "no Rust file was selected by: $(RUST_SCOPE)" >&2; exit 1; fi
# The engine crate, the bridge crate flutter_rust_bridge builds into the app, and the
# engine as WebAssembly for the web app, which cargo builds for wasm32-unknown-unknown.
RUST_CRATES := engine app/rust engine-wasm
# Every target cargo compiles for the crate's Cargo.toml, as "<kind> <name>".
RUST_TARGETS := cargo metadata --no-deps --format-version 1 | jq -r '.packages[].targets[] | "\(.kind[0]) \(.name)"'

# The configuration every build and test run is given, relative to app/ (ADR 0006).
APP_CONFIG := --dart-define-from-file=config/dev.json

# What make build produces, relative to app/, and the bridge crate library each must hold.
APK := build/app/outputs/flutter-apk/app-debug.apk
IOS_APP := build/ios/iphonesimulator/Runner.app
BRIDGE_LIB := rust_lib_knowno
# What make build builds, set on the command line: all (the default), or ios for the iOS simulator
# app alone, which CI's macOS job builds; CI's ubuntu jobs build the rest.
BUILD := all
ifeq ($(filter $(BUILD),all ios),)
$(error BUILD is "$(BUILD)"; it is all or ios)
endif

lint: lint-repo lint-code

lint-repo:
	scripts/check-secrets.sh
	scripts/check-ios-client-id.sh

lint-code:
	scripts/check-generated.sh
	scripts/check-migration-order.sh
	scripts/deno.sh lint
	scripts/web.sh lint
	cd app && $(DART_FILES); \
	flutter analyze $$files && \
	echo "analyzed $$(echo "$$files" | wc -l | tr -d ' ') Dart files in app/, selected by: $(DART_SCOPE)"
	for crate in $(RUST_CRATES); do \
		(cd $$crate && cargo clippy --locked --all-targets -- -D warnings) || exit 1; \
		targets=$$(cd $$crate && $(RUST_TARGETS)); \
		if [ -z "$$targets" ]; then echo "cargo selected no target in $$crate/" >&2; exit 1; fi; \
		echo "clippy checked $$(echo "$$targets" | wc -l | tr -d ' ') cargo targets in $$crate/, selected by cargo --all-targets:"; \
		echo "$$targets"; \
	done

format:
	scripts/deno.sh format
	scripts/web.sh format
	cd app && $(DART_FILES); \
	dart format --output=none --set-exit-if-changed $$files && \
	echo "format checked $$(echo "$$files" | wc -l | tr -d ' ') Dart files in app/, selected by: $(DART_SCOPE)"
	for crate in $(RUST_CRATES); do \
		(cd $$crate && $(RUST_FILES); \
		edition=$$(sed -n 's/^edition = "\(.*\)"/\1/p' Cargo.toml); \
		rustfmt --edition "$$edition" --check $$files && \
		echo "format checked $$(echo "$$files" | wc -l | tr -d ' ') Rust files in $$crate/, selected by: $(RUST_SCOPE)") || exit 1; \
	done

test: test-app test-db test-sync test-web

# flutter test loads the bridge library from here, in test-app and in test-sync's stack tests.
bridge:
	cd app/rust && cargo build --locked --release && \
	echo "built the bridge library into app/rust/target/release/, where flutter_rust_bridge loads it under flutter test"

test-app: bridge
	scripts/check-migration-order.test.sh
	scripts/skip.test.sh
	cd app && flutter test --reporter expanded $(APP_CONFIG) && \
	echo "ran the tests flutter test selects by default: app/test/**/*_test.dart"
	cd engine && cargo test --locked && \
	echo "ran the tests cargo test selects by default in engine/: unit tests in src/, engine/tests/*.rs, doc tests"
	scripts/wasm-bindgen.sh test

test-db:
	scripts/test-db.sh
	scripts/migration-preview.test.sh
	scripts/deno.sh test

# Writes the brand's SVGs and PNGs from tools/brand/, then the launcher icons and the splash from
# them. Not part of make ci, which checks them through scripts/web.sh lint. Revert the two edits the
# generators make beyond their output (design.md §Brand).
brand:
	node tools/brand/generate.mjs
	cd app && dart run flutter_launcher_icons && dart run flutter_native_splash:create

# Writes $(PREVIEW).json and $(PREVIEW).md: what the migrations this branch adds do to main's
# schema holding supabase/preview-seed.sql (server.md). Not part of make ci: it reports, it checks nothing.
PREVIEW := $(or $(TMPDIR),/tmp)/migration-preview
preview-migrations:
	scripts/migration-preview.sh $(PREVIEW)

test-sync: bridge
	scripts/test-sync.sh

test-web:
	scripts/web.sh test
	scripts/test-web.sh

# build is the sum of its parts; CI runs build-apk and build-ios build-engine-web as parallel jobs.
ifeq ($(BUILD),all)
build: build-ios build-apk build-engine-web
else
build: build-ios
	echo "skipped the Android APK, engine, WebAssembly and web app builds: BUILD=$(BUILD)"
endif

build-ios:
	if [ "$$(uname -s)" = Darwin ]; then \
		cd app && flutter build ios --simulator --debug --no-codesign $(APP_CONFIG) && \
		test -f $(IOS_APP)/Frameworks/$(BRIDGE_LIB).framework/$(BRIDGE_LIB) && \
		echo "built the unsigned iOS simulator app app/$(IOS_APP), holding $(BRIDGE_LIB).framework"; \
	elif [ $(BUILD) = ios ]; then \
		echo "BUILD=ios builds the iOS simulator app alone, which needs macOS, and this host is $$(uname -s)" >&2; exit 1; \
	else \
		echo "skipped the iOS simulator build: it needs macOS, and this host is $$(uname -s)"; \
	fi

build-apk:
	cd app && flutter build apk --debug $(APP_CONFIG) && \
	libs=$$(unzip -Z1 $(APK) 'lib/*/lib$(BRIDGE_LIB).so'); \
	if [ -z "$$libs" ]; then echo "app/$(APK) holds no lib$(BRIDGE_LIB).so" >&2; exit 1; fi; \
	echo "built the debug APK app/$(APK), holding the bridge library for $$(echo "$$libs" | wc -l | tr -d ' ') ABIs:"; \
	echo "$$libs"

build-engine-web:
	cd engine && cargo build --locked && \
	RUSTDOCFLAGS='-D warnings' cargo doc --locked --no-deps && \
	echo "built the library crate knowno_engine and its rustdoc from engine/Cargo.toml"
	cd engine-wasm && cargo build --locked --release && \
	RUSTDOCFLAGS='-D warnings' cargo doc --locked --no-deps && \
	echo "built the crate knowno_engine_wasm for wasm32-unknown-unknown and its rustdoc from engine-wasm/Cargo.toml"
	scripts/web.sh build

ci: lint format test build
