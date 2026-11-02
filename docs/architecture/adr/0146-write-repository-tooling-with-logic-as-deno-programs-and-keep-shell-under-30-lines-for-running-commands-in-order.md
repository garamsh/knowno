# ADR 0146: Write repository tooling with logic as Deno programs, and keep shell under 30 lines for running commands in order

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #498.** The owner, 2026-10-29: "저런 쉘스크릅티 류는 좀 깨지기 쉬운 구조라고 생각하거든. 코드로 지원되는 툴이라면 모를까."
- **The scripts held logic no type or unit test reached.** #497 moved every script to `scripts/`, and its inventory in pull request #502 found parsing, hashing, diffing, port reservation and retries in 13 of them. The inventory's definition of logic is the one this ADR adopts.
- **A shell check can stop working without saying so.** `check-secrets.sh` read JWT payloads through `jq … || true`, so a `jq` that failed on one token dropped the file's later tokens and the check went on passing.
- **Deno is already here.** The repository runs it for the Edge Functions and `tools/eval/`, and `deno test` and `deno lint` already run in `make`, so the language adds no toolchain.
- **A program needs `deno` where a script needed only `sh`.** `make lint-repo` installed nothing in CI, and it runs on a pull request that touches only documents.
- **Alternatives considered:**
  - **Python or Dart.** Neither runs in `make` as a scripting language today, so either adds a toolchain or a second way to run tests.
  - **Keep shell and add a shell test framework.** That tests the logic and leaves it untyped, and the issue's direction is code, not more shell.
  - **Permissions in a shebang.** A grant would sit beside its program, but Linux limits a shebang's length and a long grant would be cut.
  - **Permissions in a table inside `scripts/run.sh`.** Each program adds a line of shell, which would take that file past the limit below.
  - **Permissions in the `Makefile`.** A test would then have to repeat them, and it would pass under a grant the program does not ship with.
  - **Fail where `deno` is missing, locally too.** The scripts' rule since #497 is to skip locally and fail where `CI` is set, and a program takes the same rule.

## Decision

- **Language.** Repository tooling with logic is Deno TypeScript, in `scripts/`, with unit tests beside it named `*_test.ts`.
- **What becomes a program.** A script becomes a program when it does more than run commands in order: parsing, hashing, diffing, port reservation, retries, or text it builds for another tool.
- **What stays shell.** A script that only runs commands in order is Make recipe lines or a short shell file. Each shell file left in `scripts/` holds no logic beyond calling tools in order, and is under about 30 lines. A test of a program is a program.
- **Entry points stay `make` targets.** A target calls `scripts/run.sh <program>`.
- **Permissions.** `scripts/grants.txt` holds each program's grant, the narrowest it works with, and `scripts/run.sh` runs the program under it with `--no-prompt`, so a program that reaches further fails. A program's tests run it through `scripts/run.sh`, so they meet that grant.
- **Skips.** `scripts/run.sh` skips a program on a host with no `deno`, and fails where `CI` is set (`scripts/skip.sh`). That covers every program, `check-secrets` among them. A program that skips a step of its own does so through `scripts/skip.ts`, which keeps the same rule.
- **Installs.** Every CI job whose target runs a program installs `deno`, `make lint-repo`'s included.
- **Scripts still waiting.** The limit binds once #498 closes. Until then these remain as they were: `scripts/check-generated.sh`, `scripts/wasm-bindgen.sh`, `scripts/web.sh`, `scripts/test-stack.sh`, `scripts/test-db.sh`, `scripts/test-sync.sh`, `scripts/test-web.sh`, `scripts/migration-preview.sh` and `scripts/migration-preview.test.sh`. The limit is met when the last pull request of #498 lands.

## Consequences

- A check's parsing can be type-checked and unit-tested, and a program states what it may reach.
- A contributor without `deno` no longer runs `make lint-repo`'s checks: they print that they skipped. CI still fails on a miss.
- `make lint`, `format` and `test` also cover `scripts/`, each on a line of its own, so the counts of the sets they covered before read as they did.
- The tests of `check-migration-order` and `skip` move from `make test-app` to `make test-db`, inside `deno test`. A job running `make test-app` installs no `deno` for them.

## Signs the decision was wrong

- Programs grow helpers that exist only to run tools in order, and read longer than the shell they replaced with no test to show for it.
- A grant has to widen until it stops saying anything about the program.
- Contributors routinely lack `deno`, so `make lint-repo` skips on most machines.
