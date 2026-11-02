# Structure

The structural rules of the app and the web app: what the unit is, what may reference what, and when a new unit is earned.

## Current decisions

The app is partitioned by domain ([ADR 0001](adr/0001-domain-structure.md)). Domains live as folders under `app/lib/`: `deck` ([`deck.md`](deck.md)), `study` ([`study.md`](study.md)), `account` ([`account.md`](account.md)), `sync` ([`sync.md`](sync.md)), `photo_import` ([`ai-extraction.md`](ai-extraction.md)), `sharing` ([`sharing.md`](sharing.md)) and `media` ([`media.md`](media.md)).
- `sync` depends on `account` and `study` through their surfaces, and `account` reaches `sync` through `accountDataProvider`, a seam that breaks a behavioural cycle. `study`, `photo_import` and `sharing` depend on `deck`, and `sharing` on `account`, through their surfaces ([ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md)). `deck` and `sync` depend on `media`, which depends on no domain ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)). `home/` composes the domains on screen ([`home.md`](home.md)). The composition site is `app/lib/main.dart`.

### Top-level folders

Each top-level folder has one responsibility, and the lists are closed: an entry outside them is a defect, and a new one is added by an ADR naming its responsibility ([ADR 0039](adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md)).

- `app/lib/`:
  - `main.dart` — the composition site.
  - `home/` — the signed-in shell: the tabs, and every screen that shows more than one domain or leads from one domain into another.
  - `account/`, `deck/`, `study/`, `sync/`, `sharing/`, `photo_import/`, `media/` — the domains.
  - `design/` — the tokens, colours, `ThemeData`, the user's theme choice and the domain-free components.
  - `database/` — the drift database, its tables and its migration steps.
  - `l10n/` — the ARB files and the classes `gen-l10n` writes from them.
- `web/src/`:
  - `app/` — routes, the App Router files, their `_components/` and `__tests__/`; the signed-in pages and their shell's menus in the `(shell)` route group ([`web.md`](web.md)); the legal documents in the `(legal)` route group.
  - `features/` — `account`, `admin`, `decks`, `study` and `legal`.
  - `design/` — the brand's marks, the skeleton, the theme choice and its store, "다시 시도", and the dialogs' focus trap.
  - `supabase/` — the Supabase adapter, the one vendor adapter.
  - `styles/` — the global stylesheet, the fonts link and the token tests.
  - `testing/` — test infrastructure, imported by tests alone.
  - `__tests__/` — the tests of the files at the top of `web/src/`.
  - `env.ts` and `proxy.ts`, where stack-nextjs places them.
- **No top-level folder is named for a technical role**: not `shared`, `common`, `utils`, `util`, `helpers`, `lib`, `components`, `ui`, `core` or `misc`. Such a name says what a file is, not what it is for, so every file fits it.
- **The foundations** are `design/`, `database/` and `l10n/` in the app, and `design/` and `supabase/` on the web.

### Boundaries and dependency direction

- **A domain is the unit.** One folder per domain, named for its subject matter and never for a technical role.
- **A domain is reached only through what it declares public.** Everything else it holds is internal, and reaching past that surface is a defect even where the language permits it.
- **Whether a domain may depend on a sibling at all is contested.** *Domain-Driven Design* (Evans, 2003) gives no single answer: its relations between contexts run from Shared Kernel, where two share code, to Separate Ways, where neither may reference the other. A project takes one, records which, and a reference the recorded choice does not permit is a defect.
  - This project's choice: a domain may depend on a sibling only through that sibling's declared public surface, and the dependency graph between domains stays acyclic. Shared Kernel and Separate Ways are not taken.
- **A foundation sits below every domain.** "Below" refers to import direction, not folder depth:
  - nothing in a foundation imports a domain, a feature, `home/` or a route; foundations may import each other, without a cycle;
  - any domain, `home/` and `main.dart` may import a foundation, through the file it uses: a foundation declares no surface file;
  - a foundation holds nothing that serves only one domain or feature: such a file, or a class inside a file, moves into that domain or feature.
- **The shell sits above every domain.** `home/` imports domain surfaces and foundations, and nothing imports it but `main.dart`. It composes and holds no reads and no rules of its own.
  - A domain imports no screen of another domain. A screen that shows two domains, or opens one domain's screen from another's, belongs to `home/`, which builds it from the domains' exported widgets and hands values and callbacks between them, as a web route does.
  - A domain widget with a place for something another domain draws takes it as a constructor argument from its caller in `home/`.
- **A seam exists only for a test double, an alternative implementation, or breaking an import cycle a behaviour would create.** A seam is a provider or an interface a domain declares for something outside it to supply. It never lets one domain host another's screen or widget; the shell composes those instead.
- **A cycle between domains means the split is wrong**, and so does a file that belongs in two of them.
- **A new domain is earned** by subject matter with its own lifecycle and vocabulary, which something outside it depends on, and whose public surface can stay stable while its inside changes.

### Public surface and foundations

- **A domain declares its public surface in one library file named for it**, `app/lib/<domain>/<domain>.dart`, which exports with `show` the names a caller may use ([ADR 0002](adr/0002-domain-public-surface-and-shared-database.md)).
- **Everything else a domain holds lives under `app/lib/<domain>/src/`.** An import of another domain's `src/` path is a defect, from a sibling or from the composition site. A domain's own tests, those under `app/test/<domain>/`, may import its `src/` files; no other test may.
- **The structural rules are checked by a test.** `app/test/architecture_test.dart` fails on:
  - an entry under `app/lib/` outside the closed list;
  - an import from a foundation into a domain or `home/`, and an import of `home/` from anywhere but `main.dart`;
  - an import into a domain's `src/` from outside that domain;
  - an import into a domain's `src/` from a test under `app/test/` that is not under that domain's folder there;
  - a foundation file whose importers outside its folder all sit in one domain or all in `home/`;
  - a domain file that names a screen another domain's surface exports, a name ending in `Screen`;
  - a file in `home/` that declares a provider or imports the database, a read of its own.
  A class inside a foundation file that serves one domain is not visible to it; review holds that.
- **The app theme is a foundation.** `app/lib/design/theme.dart` holds every colour token, the type, spacing, radius, height and shadow scales and the light and dark themes, and `app/lib/design/theme_choice.dart` the user's choice between them; no other file under `app/lib/`, but Google's button, writes a colour ([ADR 0011](adr/0011-shared-app-theme-bundled-font-and-today-builder.md), [ADR 0021](adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md), [`design.md`](design.md)).
- **The components are a foundation.** `app/lib/design/` holds the buttons, fields, rows, chips, section labels, sheets and the mascot every screen builds from, one file per component. They import only Flutter, the theme and the strings, and a domain imports the file it uses ([ADR 0021](adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md), [`design.md`](design.md)).
- **The brand's files are assets, not code.** `app/assets/brand/` holds the marks the app draws, as PNGs at 1x to 3x, and, in `icon/` and `splash/`, the sources the launcher icons and the splash are generated from, which the app does not bundle; `web/public/` holds the web's icons and manifest, and `web/public/brand/` the marks as SVGs. `tools/brand/generate.mjs` writes them all from `tools/brand/` ([ADR 0139](adr/0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md), [`design.md`](design.md)).
- **The drift database is a foundation.** `app/lib/database/database.dart` holds every domain's tables. A domain maps rows into its own types and does not export row classes.
- **Every schema change goes through a migration.** The change raises `schemaVersion`. In `app/`, `dart run drift_dev make-migrations` then exports the new schema to `drift_schemas/` and its helpers to `test/drift/`, and the migration test there must pass.
- **User-facing strings come from one ARB set.** It lives in `app/lib/l10n/`, with Korean as the template and default locale. No widget hardcodes a string the user reads.
- **Generated code is committed and regenerated from its source.** This covers `database.g.dart` (via `dart run build_runner build`), the `gen-l10n` output (via `flutter gen-l10n`), the drift schema dumps, helpers and `database.steps.dart` (via `make-migrations`), and flutter_rust_bridge's Rust and Dart output (via `flutter_rust_bridge_codegen generate`, [ADR 0004](adr/0004-flutter-rust-bridge.md)). `make lint` runs `scripts/check-generated.sh`, which reruns every generator and fails when a committed file differs from what it writes.

### Composition

- **The application has one composition site.** It is the one place that constructs concrete implementations, and it decides which implementation each declared abstraction receives.
- **Every other unit receives what it depends on and constructs none of it**, whatever the shape makes the unit — a domain, a layer, or an adapter.
- **The composition site stays thin.** It constructs and passes; it decides nothing else. It opens the theme storage, and passes the themes and the stored choice to `MaterialApp`, whose home is `account`'s `AccountGate`, given `home/`'s shell as the signed-in screen; the gate decides between the sign-in screen and the app ([ADR 0017](adr/0017-require-sign-in-through-an-account-gate.md)).

### The web app

- **`web/` is a project of its own** ([ADR 0019](adr/0019-web-app-stack-portability-and-sign-in.md), [`web.md`](web.md)). Nothing under `web/` imports code from `app/`. It reads three of the app's files: the fonts in `app/assets/fonts/`, through the link `web/src/styles/fonts`; `app/lib/design/theme.dart`, whose tokens a test compares with `web/src/styles/globals.css`; and `app/lib/study/src/queue.dart`, whose queue constants a test compares with `web/src/features/study/queue.ts` ([ADR 0033](adr/0033-count-cards-left-per-study-day-from-04-00-and-continue-as-unrecorded-practice.md)). It imports the engine's generated module in `engine-wasm/pkg/` through the link `web/src/features/study/engine-wasm` ([ADR 0022](adr/0022-study-on-the-web-with-the-engine-in-the-browser.md)).
- **A feature is the unit**, under `web/src/features/<name>/`, as a domain is under `app/lib/`, and is earned the same way. The features are `account`, `admin`, `decks`, `study` and `legal`. `admin` depends on `decks` for card content and on `study` for the study day ([ADR 0070](adr/0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md)).
- **A feature may depend on a sibling only through its entry points, and the graph stays acyclic**, as between domains. `study` depends on `decks` for the types of decks and cards; `decks` imports no feature. A route composes the two: it reads with both and hands `study`'s counts to `decks`' components as values, as the app's `home/` hands `study`'s counts to `deck`'s widgets.
- **A feature is reached only through its two entry points**, stack-nextjs §13's spelling of a domain's public surface: `index.ts`, what a Server Component reads, and `actions.ts`, its Server Actions. A feature's own files import each other directly.
- **The routes are the web's shell**, as `home/` is the app's: a route imports features and foundations, and nothing imports a route.
- **A foundation sits below every feature**: `web/src/design/`, `web/src/supabase/` and `web/src/env.ts` import no feature and no route. What belongs to one feature's subject lives in it, and a sibling reaches it through that feature's entry points: the card content blocks in `decks`, as the app's are `deck`'s; the study day's time zone in `study`; the legal documents' layout and links in `legal`.
- **A client module takes a sibling feature's values from the server.** A client module cannot import a feature's `index.ts` that carries server-only code (stack-nextjs §13), so the server component rendering it passes in what it needs, such as a card side described as text.
- **The structural rules are checked by a test and by ESLint.** `web/src/__tests__/structure.test.ts` fails on an entry under `web/src/` outside the closed list. `web/eslint.config.mjs` fails on an import of `@/features/<name>/` other than its `index` or `actions`, and on an import of `@/features/` or `@/app/` from a foundation.
- **Each web feature has its own responsibility document**, `web-<feature>.md` beside [`web.md`](web.md), which holds the stack, the foundations and the shell ([ADR 0081](adr/0081-document-each-web-feature-in-its-own-responsibility-document-beside-web-md-and-name-each-test-file-s-behaviour-in-one-line.md)): [`web-account.md`](web-account.md), [`web-admin.md`](web-admin.md), [`web-decks.md`](web-decks.md), [`web-study.md`](web-study.md) and [`web-legal.md`](web-legal.md). A new feature adds its document with it.
- **The web app has no single composition site.** Next.js calls each route, Route Handler, Server Action and the proxy as an entry point of its own, per request. Each constructs the Supabase client it needs through `web/src/supabase/`, the one place that constructs one.

## Rationale


- [ADR 0001](adr/0001-domain-structure.md) records why the app is partitioned by domain and which sibling-dependency relation it takes.
- [ADR 0002](adr/0002-domain-public-surface-and-shared-database.md) records how a domain declares its public surface and why the database sits below the domains.
- [ADR 0039](adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md) records the closed lists of top-level folders, the refusal of technical-role names, the foundations, the shell and the seam rule, and how each is checked.
- [ADR 0004](adr/0004-flutter-rust-bridge.md) records why the generated engine bindings sit inside the `study` domain.
- [ADR 0006](adr/0006-account-native-google-sign-in.md) records why only the `account` domain imports the Google packages, and [ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md) why `sync` imports `supabase_flutter` beside it.
- [ADR 0011](adr/0011-shared-app-theme-bundled-font-and-today-builder.md) records how the composition site applies the theme.
- [ADR 0021](adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md) records why the scales sit in the theme file and the components in a layer below the domains.
- [ADR 0017](adr/0017-require-sign-in-through-an-account-gate.md) records why the app's home is the account gate.
- [ADR 0019](adr/0019-web-app-stack-portability-and-sign-in.md) records why the web app is a project of its own and how it reaches the app's fonts.
- [ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md) records why sharing is a domain of its own and why it imports `supabase_flutter`.
- [ADR 0081](adr/0081-document-each-web-feature-in-its-own-responsibility-document-beside-web-md-and-name-each-test-file-s-behaviour-in-one-line.md) records why each web feature has its own document beside `web.md`.

## Open questions

- None.
