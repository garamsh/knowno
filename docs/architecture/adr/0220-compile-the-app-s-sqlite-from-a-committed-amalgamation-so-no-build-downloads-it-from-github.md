# ADR 0220: Compile the app's SQLite from a committed amalgamation so no build downloads it from GitHub

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

The `sqlite3` package (transitive, through drift, locked at 3.5.2) supplies SQLite through a build hook. By default the hook downloads a prebuilt library from `https://github.com/simolus3/sqlite3.dart/releases/` and compares its SHA-256 with the one in the package. During GitHub's 504 errors (2026-11-05 to 2026-11-08) the download returned an error page, whose hash is `bef140a1…`, and `make build-apk` failed with "Hash of downloaded file libsqlite3.x64.android.so is …" on #815 twice, though the asset itself was intact (#817). A failure at github.com so fails every app build, and the build then ships whatever release the package version names.

`doc/hook.md` of `sqlite3` (3.5.2 and 3.9.1 alike) lists the options:

- `source: sqlite3` (the default): the download above, with `url_pattern` to point it at another host. That still fetches at build time.
- `source: system`, `process` or `executable`: the operating system's SQLite, or one the app links itself. The version then varies by device and OS release, which the package's own page calls inconsistent and often outdated.
- `source: source` with `path: <sqlite3.c>`: the hook compiles the given amalgamation with the package's default compile options, with no download. "If you want to customize the SQLite build … download the `sqlite3.c` file you want to use into your workspace."

Rejected beside them: retrying, or caching `.dart_tool/hooks_runner/shared/sqlite3/`, which keeps the dependency and fails on the first run of a clean runner. Upstream's fix in 3.9.1 only improves the error message, and the maintainer's CDN is a future option.

## Decision

`app/pubspec.yaml` holds `hooks: user_defines: sqlite3: source: source, path: third_party/sqlite/sqlite3.c`, and `app/third_party/sqlite/sqlite3.c` is the SQLite 3.54.1 amalgamation (`sqlite-amalgamation-3540100.zip` from sqlite.org, SHA3-256 `92281c86e2957f9b9305890f9ac04204caa7b677cc868dc326d942689df28e30` as its download page lists it; the file's SHA-256 is `0c657666d819f261cc4007526ad57e1669de9949df7a8ea847aa284a2bf0ee52`). The `sqlite3` package stays at 3.5.2: its `source` option is documented there, so no version bump is needed and `pubspec.lock` does not change. The hook's default compile options apply, as for the download.

A test, `app/test/drift/app_database/sqlite_version_test.dart`, asserts that the database runs 3.54.1, so a removed option, which would fall back to the download's 3.53.4, fails `make test-app`.

## Consequences

- No app build (APK, iOS simulator, release) fetches SQLite. The hook compiles it with the platform's C toolchain, which the Rust bridge's build already needs. The same file gives the same SQLite 3.54.1 on every build and platform.
- A build takes the time to compile about 9.6 MB of C once per target.
- The repository holds a 9.6 MB generated file. Moving SQLite is the PM's: one PR replaces the file from the newest amalgamation on sqlite.org's download page, and changes this ADR's successor and the version in the test. Dependabot cannot see the file, so a SQLite security release is checked for when the PM reviews app dependencies.
- The web app and the server are untouched.

## Signs the decision was wrong

- A target fails to build in the hook's compile step, such as iOS or an Android ABI, on a package or toolchain update.
- Moving the file lags a SQLite security advisory by more than a review cycle.
- The package's hook drops or renames `source: source`.
