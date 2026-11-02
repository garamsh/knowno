# Engine

The scheduling engine: how a card's memory state and next due time are computed from its review history, and today's list from a study day's reviews.

## Current decisions

- **Location.** `engine/`, the library crate `knowno_engine`, separate from the Flutter app. The app calls it through the bridge crate in `app/rust/` ([`study.md`](study.md), [ADR 0004](adr/0004-flutter-rust-bridge.md)), and the web app through the WebAssembly crate in `engine-wasm/` (below); both depend on it by path.
- **Algorithm.** FSRS-6 as py-fsrs v6.3.2 implements it, with its default parameters, desired retention 0.9 and a maximum interval of 36500 days ([ADR 0003](adr/0003-fsrs-engine.md)). The formulas are in `engine/src/fsrs.rs`; no FSRS crate is a dependency.
- **Pure functions.** The engine reads no clock, does no I/O and stores nothing. The caller passes the time of every review and keeps the history.
  - `review` takes a card's state (none for a new card), a rating, the time and an optional fuzz factor, and returns the new state and the due time.
  - `replay` folds a history of reviews into a state.
  - Correcting the last answer is replaying the history with that rating changed.
  - `today` places a card in a study day's list, apart from FSRS ([ADR 0061](adr/0061-keep-a-card-failed-today-in-today-s-list-until-it-is-passed-through-a-pure-engine-function-over-the-day-s-reviews.md)). From the card's due time, its reviews and a `StudyDay`, it returns:
    - `Left` when its latest review in the day is `Again`, or when it has none in the day and falls due before the day ends;
    - `Done` when its latest review in the day is above `Again`;
    - `Absent` otherwise.
    The day runs from its start, inclusive, to its end, exclusive, and the caller sets both bounds: the app's are 04:00 to 04:00. Reviews outside the day are ignored, and of two at one time the later given counts. It returns no error.
    The caller's part: `Done` counts any rating above `Again`, so a new card first answered that day, or a card studied past the day's queue, is done too; new cards still to come from the day's quota are `Absent`, for the caller to add; and the caller leaves deleted reviews out.
  - A caller may persist a state's parts instead of replaying every time; `MemoryState::from_parts` rebuilds it, and a state rebuilt from the parts of a replay equals that replay.
- **Invalid input is an error, not a panic.** The public functions return `Result` with the typed `Error`: a review dated before the last one, a number that is not a rating, and a non-finite or out-of-range stability, difficulty or fuzz factor.
- **Documented surface.** The crate denies missing docs, and `make build` builds its rustdoc with warnings denied. No bridge type lives in `engine/`.
- **Ratings.** The engine accepts the four FSRS ratings. The app's two buttons map at the public surface, not in the formulas: "Know" is `Good`, "Don't know" is `Again`.
- **No learning steps.** The state is stability, difficulty and the last review time; every interval is whole days. A card failed today stays in today's list until it is passed, through `today` over the day's reviews, not through a step state ([ADR 0061](adr/0061-keep-a-card-failed-today-in-today-s-list-until-it-is-passed-through-a-pure-engine-function-over-the-day-s-reviews.md)). The order of re-shows within a session belongs to the app's session queue.
- **Fuzz.** Given a `FuzzFactor` in `[0, 1)`, `review` fuzzes the interval as py-fsrs v6.3.2's `Scheduler._get_fuzzed_interval` does: an interval under 2.5 days is unchanged, a longer one moves to a whole number of days in a range around it that widens with the interval ([ADR 0012](adr/0012-fuzz-review-intervals.md)). The engine draws nothing: without a factor the interval is not fuzzed. Fuzz moves the due time, not the state, so `replay` takes no factor.
- **Reference values.** `engine/tests/fixtures/generate.py` runs py-fsrs 6.3.2, pinned with its dependencies in `generate.py.lock`, over fixed rating sequences and writes `engine/tests/fixtures/reference.json`: each sequence without fuzzing, and again with fuzzing under seeds 1 and 2, recording the factor each review drew. Regenerate with `uv run --locked --script engine/tests/fixtures/generate.py` from the repository root. CI does not run Python; the tests read the committed file.
- **Simulations.** Two examples drive the engine through seeded simulated users and print the tables that chose a study rule; run each from `engine/` with `cargo run --locked --release --example <name>`. `make lint` and `make test` compile them, and nothing runs them.
  - `engine/examples/backlog.rs`, a user with a review backlog: the study queue's backlog order, run size and threshold ([ADR 0025](adr/0025-order-a-review-backlog-by-due-date-and-pause-new-cards.md)).
  - `engine/examples/daily_load.rs`, users of five study habits whose pace speeds up with familiarity: the constants of a day's new cards and the cap on an answer's duration ([ADR 0043](adr/0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md)).
- **Checks.** `make lint`, `format`, `test` and `build` each cover the crate. The toolchain is pinned in `engine/rust-toolchain.toml`; Dependabot proposes its bumps and those of `engine/Cargo.toml`.

### WebAssembly

- **Crate.** `engine-wasm/`, the crate `knowno_engine_wasm`, built only for `wasm32-unknown-unknown` (`engine-wasm/.cargo/config.toml`) with the Rust release of `engine/rust-toolchain.toml` ([ADR 0018](adr/0018-engine-as-webassembly.md)). It declares its own types, converted to and from the engine's by exhaustive matches, and `engine/` holds no WASM or JS dependency.
- **Surface.** `engine-wasm/src/lib.rs` exports the bridge's operations ([`study.md`](study.md)):
  - `reviewNewCard` — a new card's first review, with an optional fuzz factor;
  - `reviewCard` — a review of a card from its persisted state parts, with an optional fuzz factor;
  - `replay` — a history folded into a state;
  - `retrievability` — the probability of recall at a time;
  - `todaysList` — each card's place in a study day's list, `"absent"`, `"left"` or `"done"`, from its due time and reviews, in the order given; it returns the list itself, since `today` refuses nothing.
- **Values.** Times are whole seconds since the Unix epoch, `bigint` in TypeScript. Answers are the app's two buttons, `"know"` and `"dontKnow"`, mapped to `Good` and `Again` in the crate, as the bridge maps them.
- **Failures.** Each operation returns `Outcome<T>`, `{ ok: T }` or `{ error: EngineError }`. `EngineError` is a union told apart by `kind`, one member per engine `Error` variant; `unknownRating` cannot arise from a surface that takes answers. An argument the TypeScript types rule out, such as a `number` for a time, is thrown as a JS `Error`, as a programming error. The crate denies `panic!`, `unwrap`, `expect` and indexing.
- **Generated module.** `engine-wasm/pkg/` holds the JS glue, its `.d.ts`, with every type above declared from the Rust types by tsify, and the `.wasm`, and is committed. `scripts/wasm-bindgen.sh generate` writes it with the `wasm-bindgen` CLI from its prebuilt release archive, `--target web`, at the release `engine-wasm/Cargo.lock` pins (a build of the CLI from source writes a different `.wasm`), mapping the Cargo home and the repository to fixed prefixes, with the release profile stripping symbols, so every host writes the same module. `scripts/check-generated.sh` reruns it and fails when the output differs.
- **Use.** The web app loads `pkg/` in the browser through a link to it, and calls it from its `study` feature ([`web-study.md`](web-study.md)).
- **Tests.** `make test` runs `scripts/wasm-bindgen.sh test`: `engine-wasm/tests/` as WebAssembly in Node, through `wasm-bindgen-test-runner`.
  - `reference.rs` runs every review of every sequence in `reference.json` made only of Again and Good, unfuzzed and fuzzed, through the exported operations, and prints the count and that selection. The Hard and Easy sequences, which no answer gives, are checked by the native tests only.
  - `errors.rs` reads a refused review's returned value from JavaScript, switching on its `kind`, with an accepted control.
  - `replay.rs` reads an empty history's replay from JavaScript as `{ ok: null }`, as its declared type says.
  - `today.rs` reads `todaysList`'s entries from JavaScript as their strings, in the order given.
- **Checks.** `make lint` runs clippy over the crate for `wasm32-unknown-unknown` and `make format` checks it; `make build` builds it and its rustdoc, warnings denied. Without a `wasm-bindgen` command, `scripts/check-generated.sh` and `make test` skip the crate and say so; without `node`, `make test` does. Where `CI` is set, each fails instead, and CI installs both in the jobs that run them.
- **Pins.** wasm-bindgen is pinned exactly (`=0.2.129`), as are wasm-bindgen-test and, through them, js-sys, which require it exactly; CI installs the CLI at the release in `engine-wasm/Cargo.lock`. Dependabot proposes the three as one group, and the toolchain in `engine-wasm/rust-toolchain.toml`; a wasm-bindgen bump lands with the regenerated `pkg/`. Node is pinned in `.github/workflows/ci.yml`, and the PM bumps it.

## Rationale

- [ADR 0003](adr/0003-fsrs-engine.md) records the FSRS version and its sources, and why steps live in the session queue.
- [ADR 0012](adr/0012-fuzz-review-intervals.md) records the fuzz formula and its source, why the caller supplies the factor, and why it supersedes ADR 0003's "The engine does not fuzz".
- [ADR 0061](adr/0061-keep-a-card-failed-today-in-today-s-list-until-it-is-passed-through-a-pure-engine-function-over-the-day-s-reviews.md) records why today's list is a pure engine function over the day's reviews rather than learning steps or a stored plan, and why it sits in the crate the app, the web and the server share; issue #195 records the owner's decision.
- [ADR 0018](adr/0018-engine-as-webassembly.md) records why the web app's engine is a separate crate built with the wasm-bindgen CLI, why it takes the two answers, and why errors are returned rather than thrown.
- [ADR 0025](adr/0025-order-a-review-backlog-by-due-date-and-pause-new-cards.md) and [ADR 0043](adr/0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md) record what each simulation models and the tables it printed.

## Open questions

- Whether desired retention or the parameters become per-user settings waits on parameter optimization from a user's review logs, which issue #5 leaves to a later milestone.
- Whether to move from FSRS-6 to FSRS-7: [`docs/research/fsrs-7.md`](../research/fsrs-7.md) assesses it (issue #54) and recommends waiting for a released FSRS-7, an owner decision on sub-day due times, and a rollout path for card states across app versions.
