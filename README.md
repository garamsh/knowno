# knowno

A memorization app, 알아몰라 in Korean: decks of cards studied on a phone and at `https://knowno.app`. This file is the project's entry point for anyone running or changing it.

## Who it is for

- People who memorize material by studying decks of cards on iOS or Android, or in a browser.
- Contributors: start at `AGENTS.md`, then `docs/convention/README.md` and `docs/architecture/README.md`.

## Layout

- `app/` — the Flutter application (iOS and Android).
- `app/config/` — the app's configuration per environment, passed with `--dart-define-from-file`; only `dev.json` exists. Its values are public; a Supabase secret or service-role key never goes there.
- `app/assets/fonts/` — the app's and the web app's font, Pretendard 1.3.9 (Regular, Medium, SemiBold, Bold, ExtraBold), bundled under the SIL Open Font License 1.1 in `app/assets/fonts/OFL.txt`; neither downloads a font at run time. The files are `public/static/*.otf` of `Pretendard-1.3.9.zip` from the v1.3.9 release of github.com/orioncactus/pretendard (SHA-256 `04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a`), each byte-identical to the npm package `pretendard@1.3.9`. No bot proposes their update; the PM moves them by the same verification.
- `app/rust/` — the flutter_rust_bridge crate through which the app calls the engine.
- `engine/` — the Rust crate that schedules reviews with FSRS.
- `engine-wasm/` — the engine as WebAssembly for the web app; its generated module, committed, is in `engine-wasm/pkg/`.
- `web/` — the Next.js web app, its `Dockerfile`, and its e2e specs in `web/e2e/`; `scripts/web.sh` runs the checks over it.
- `supabase/` — the Supabase CLI project for the backend: its configuration, migrations in `supabase/migrations/`, and pgTAP tests in `supabase/tests/`.
- `supabase/functions/extract-cards/` — the Edge Function that turns a photo of a study page, a vocabulary page or notes, into candidate cards, with its Deno tests.
- `tools/eval/` — the eval that measures candidate models for that function, its generated sample set, and the generator.
- `supabase/functions/delete-account/` — the Edge Function that deletes the caller's account and every row it owns, with its Deno tests.
- `supabase/functions/_shared/` — the code both Edge Functions use: reading the caller from Supabase Auth.
- `docs/convention/` — the conventions every change follows.
- `docs/architecture/` — the structure of the system and the decisions behind it.
- `docs/procedure/` — the procedures for dispatching a worker, reviewing a pull request and anchoring a claim, ranked below every convention.
- `docs/eval/` — the eval's latest report, which a run writes.
- `docs/research/` — assessments made for an issue, such as moving the engine to FSRS-7.
- `Makefile` — the entry points for the project's checks.
- `scripts/` — the scripts the entry points run (§Run the checks): the `scripts/check-*.sh` checks; `scripts/deno.sh`, `scripts/web.sh` and `scripts/wasm-bindgen.sh`, the Deno, web app and WebAssembly parts; the `scripts/test-*.sh` stack tests; and the migration preview. Where a step's tool or Docker is missing, a script skips the step and says so, and where `CI` is set it fails instead (`scripts/skip.sh`).
- `.github/` — the CI workflow, Dependabot configuration, and issue and pull request templates.

## Requirements

- Flutter 3.47.7 (stable channel), pinned once in `app/pubspec.yaml` under `environment: flutter:`; CI reads it from there. The PM bumps it when a new stable Flutter release ships.
- JDK 17 for the Android build; with Flutter, point it at the JDK with `flutter config --jdk-dir`.
- Android SDK 36 for the Android build; Xcode for iOS.
- Supabase CLI 2.120.0 for the backend; CI's ubuntu job installs the same release, set in `.github/workflows/ci.yml`. The PM bumps both when a new release ships.
- Deno 2.9.7 for the Edge Function and the eval; CI installs the same release, set in `.github/workflows/ci.yml`. The PM bumps both when a new release ships. Without it, `make lint`, `make format` and `make test` skip the Deno steps and say so.
- Docker for the local backend and its tests; on macOS, `brew install colima docker`, then `colima start`. Without it, `make test` skips the database tests and says so.
- Rust 1.99.0 with clippy and rustfmt for the engine, the bridge crate and `engine-wasm/`, pinned in `engine/rust-toolchain.toml`, `app/rust/rust-toolchain.toml` and `engine-wasm/rust-toolchain.toml`; rustup installs it, the Android and iOS targets the bridge crate lists and `engine-wasm/`'s `wasm32-unknown-unknown`, on first use. Dependabot proposes the bump when a new stable Rust release ships.
- flutter_rust_bridge_codegen at the release of the `flutter_rust_bridge` crate in `app/rust/Cargo.lock`, 2.13.0: `cargo install flutter_rust_bridge_codegen --version 2.13.0 --locked`. `make lint` fails when another release is installed.
- The Android NDK release Flutter names (`flutter.ndkVersion` in `app/android/app/build.gradle.kts`), for the bridge crate's Android build.
- wasm-bindgen-cli at the release of the `wasm-bindgen` crate in `engine-wasm/Cargo.lock`, 0.2.129, for the engine's WebAssembly module and its tests: the prebuilt archive for this host from the 0.2.129 release at github.com/wasm-bindgen/wasm-bindgen/releases, its `wasm-bindgen` and `wasm-bindgen-test-runner` on the `PATH`. CI installs the same archive. A build of the same release from source (`cargo install wasm-bindgen-cli`) writes a different `.wasm`, which `make lint` reports as stale. Without it, `make lint` skips checking `engine-wasm/pkg/` and `make test` skips the WebAssembly tests, and each says so; another release fails both.
- Node 24.22.0 to run the WebAssembly tests; CI installs the same release, set in `.github/workflows/ci.yml`. The PM bumps both when a new LTS release ships. Without it, `make test` skips those tests and says so.
- jq, which `make lint` uses to list the engine's cargo targets, to read service-role keys' JWT payloads, and to read `app/config/dev.json`.
- Node.js 24.22.0 for the web app, named in `web/.nvmrc`; CI installs that release in each job that runs `scripts/web.sh` or the WebAssembly tests, and `scripts/web.sh` fails wherever the running Node differs from that file. The PM bumps it together with the `node:` base image in `web/Dockerfile`, whose digest Dependabot proposes; `make lint` fails while the two differ. Without Node.js, `make lint`, `make format`, `make test` and `make build` skip the web app and say so.
- docker-buildx, for the web app's image: on macOS, `brew install docker-buildx`, then link it into `~/.docker/cli-plugins/`. Without Docker and buildx, `make test` skips the web app's e2e specs and `make build` its image, and both say so.
- uv, only to regenerate the engine's reference values and the eval's samples; it fetches the Python and the packages each generator pins.

## Run the app

```sh
cd app
flutter run --dart-define-from-file=config/dev.json
```

The app opens on the sign-in screen until a Google account signs in; a session stored by an earlier run opens it straight away, offline too. Without the file, the sign-in screen says sign-in is not set up, and nothing else runs.

## Run the web app

```sh
cd web
cp .env.example .env.local   # then fill in the two values
npm ci
npm run dev
```

- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; both are public, and the dev project's are `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `app/config/dev.json`. Git ignores `.env.local`.
- Google sign-in returns to `<origin>/auth/callback`, which must be among Supabase Auth's allowed redirect URLs; only the owner changes that list.

The image, built from the repository root:

```sh
docker build -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
  -t knowno-web .
docker run --rm -p 3000:3000 knowno-web
```

- It is built from the root because it bundles the fonts in `app/assets/fonts/`.
- Both values are frozen into the image, so an image serves one Supabase project.
- `GET /api/health` answers 200 once the server runs. The image serves on port 3000 as a non-root user.
- The design and deployment rules are in `docs/architecture/web.md`.

## Run the checks

- `make lint` runs, in this order:
  - `scripts/check-secrets.sh` — fails on a Supabase secret or service-role key in any file;
  - `scripts/check-ios-client-id.sh` — the iOS URL scheme against the iOS client ID in `app/config/dev.json`;
  - `scripts/check-generated.sh` — the app's committed generated code (flutter_rust_bridge's included) and `engine-wasm/pkg/` against their generators;
  - `scripts/check-migration-order.sh` — each migration `main` lacks sorts after every migration on `main` (`docs/architecture/server.md`);
  - `scripts/deno.sh lint` — lints and type-checks the TypeScript under `supabase/functions/` and `tools/eval/`;
  - `scripts/web.sh lint` — lints and type-checks the web app with ESLint and `tsc`, and fails on Vercel-only code in it;
  - then `flutter analyze` over the app's Dart files, and clippy over the engine, the bridge crate and `engine-wasm/` with warnings denied.
- `make format` — fails when a TypeScript file under `supabase/functions/` or `tools/eval/`, a file Prettier checks in the web app, a Dart file in the app, or a Rust file in the engine, the bridge crate or `engine-wasm/` is not formatted; `deno fmt`, `npx prettier --write .` in `web/`, `dart format` or `cargo fmt` fixes it.
- `make test` — runs `scripts/check-migration-order.test.sh`, the migration order check against repositories it builds in a temporary directory, then builds the bridge crate for this host, then runs the app's tests, given `app/config/dev.json`, the engine's tests, the engine's WebAssembly tests in Node (`scripts/wasm-bindgen.sh test`), and the database tests in `supabase/tests/` on a throwaway local stack of their own (`scripts/test-db.sh`), stopped afterwards, so concurrent checkouts do not collide and a running local stack is left untouched. It then runs the two-device sync test, `app/test/sync/two_devices_test.dart`, against another throwaway stack with Auth and PostgREST (`scripts/test-sync.sh`). Without Docker it skips both and prints why. Then it runs the Deno tests of the Edge Function and the eval, with no network: OpenRouter and Supabase are faked. Then it runs the web app's Vitest suite, with Supabase faked, and, where Docker and buildx answer, builds the web app's image, runs it, checks it answers `/api/health` as a non-root user, and runs the Playwright specs in `web/e2e/` against it (`scripts/web.sh test`). Last, `scripts/test-web.sh` runs every spec in `web/e2e/` against the web app built for another throwaway stack.
- `make build` — builds, given `app/config/dev.json`, a debug Android APK holding the bridge library, on macOS also the iOS simulator app without code signing, the engine crate with its rustdoc, `engine-wasm/` for `wasm32-unknown-unknown` with its rustdoc, warnings denied, and the web app with `next build`, then its image where Docker and buildx answer. It reports which builds it ran. `make build BUILD=ios` builds the iOS simulator app alone, and fails on a host other than macOS.
- `make ci` — runs all four in that order. CI's ubuntu job runs the same target, which skips the iOS simulator build there, and its macOS job runs `make build BUILD=ios`.

## Run the backend locally

```sh
supabase start
supabase db reset
supabase test db
supabase stop
```

- `supabase start` runs the local stack from `supabase/config.toml` and applies the migrations in `supabase/migrations/`. It needs Docker.
- `supabase db reset` recreates the local database from the migrations, deleting its rows.
- `supabase test db` runs the pgTAP tests in `supabase/tests/`.
- `supabase stop` stops the stack.

The schema is described in `docs/architecture/server.md`. A migration reaches the production project when its pull request merges: Supabase's GitHub integration applies it, and no one runs `supabase db push` (`docs/architecture/server.md` §Location and migrations).

## Run the eval

The eval needs the OpenRouter key in `supabase/functions/.env`, as `OPENROUTER_API_KEY=...`; git ignores that file, and only the owner creates it. Its spend is capped at $10 across all runs, recorded in `tools/eval/spend.json`.

```sh
deno run --allow-read --allow-write=tools/eval/spend.json,docs/eval,tools/eval/replies \
  --allow-net=openrouter.ai --allow-env=OPENROUTER_API_KEY --env-file=supabase/functions/.env \
  tools/eval/run.ts --dry-run
```

- `--dry-run` resolves the candidates in `tools/eval/candidates.json` to model IDs, prints the estimated cost, and calls no model. Without it the run starts when the estimate fits the remaining budget, keeps every reply under `tools/eval/replies/`, which git ignores, writes `docs/eval/extract-cards.md`, and appends its spend to `tools/eval/spend.json`; commit both.
- `uv run --locked --script tools/eval/generate.py` regenerates the samples in `tools/eval/samples/`.
- The method is described in `docs/architecture/ai-extraction.md`.
