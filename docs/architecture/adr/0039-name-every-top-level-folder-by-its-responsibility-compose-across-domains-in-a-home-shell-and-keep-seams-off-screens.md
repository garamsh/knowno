# ADR 0039: Name every top-level folder by its responsibility, compose screens across domains in a home shell, and keep seams off screens

> Status: accepted
> Date: 2026-10-16

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #94: the owner asked on 2026-10-16 for a production structure organised by responsibility, componentised but not excessively, without catch-alls such as `common`. A structure review on `main` at `b4958d25d79c43fd935ec764c34e1816846804b8`, re-checked here at `cf494ca6fcc4fbd2e934f3ad5acdcfd191d141f4`, found:
  - `app/lib/shared/` is the one folder under `app/lib/` that is not a domain ([ADR 0002](0002-domain-public-surface-and-shared-database.md)), and holds whatever two domains need. It holds four unrelated responsibilities: the drift database (`database.dart`), the strings (`l10n/`), the theme (`theme.dart`: tokens, colours, `ThemeData`, the theme choice and `GoogleButtonStyle`, which only `account/src/google_button.dart` reads) and the components (`ui/`).
  - `web/src/components/` holds the brand, the skeleton, the theme choice and the legal documents' layout and links; `web/src/lib/` holds the card content blocks, the theme store, the study day's time zone and the Supabase adapter. stack-nextjs §1 prescribes both folders.
  - `app/lib/deck/src/providers.dart` declares `studyScreenProvider`, `todayProvider`, `photoImportProvider`, `accountScreenProvider`, `accountAvatarProvider` and `deckSharingProvider`, each overridden in `app/lib/main.dart` so that `deck`'s screens can show or open another domain's screen. `deck_list_screen.dart` is the app's home and `card_list_screen.dart` the deck's page, and each reads four of them. `account` does the same through `signedInHomeProvider` and `syncStatusProvider`. Issue #89's tabs would add a slot per tab.
  - The web's `features/auth` is the app's `account`, against style.md's "Same concept, same name".
- A folder named for a technical role (`shared`, `common`, `utils`, `lib`, `components`, `ui`) says what its files are, not what they are for, so any file fits it, and the rule "a file that serves only one domain is a defect" (structure.md) had to be held by review alone: `GoogleButtonStyle` passed it.
- The web already composes as this ADR asks of the app: a route reads with two features and hands one's values to the other's components ([ADR 0022](0022-study-on-the-web-with-the-engine-in-the-browser.md), structure.md). The app instead routes that composition through providers in the domain that hosts the screen.
- Alternatives considered:
  - Keep `shared/` and split it into subfolders (`shared/theme/`, `shared/ui/`). The top-level name still admits anything, and the review rule stays unchecked.
  - Put the theme and the components in a `ui/` or `components/` folder. That is a technical role again; `design/` names the responsibility, the design system the app is drawn in, which `docs/architecture/design/` already owns.
  - Keep the cross-domain screens in `deck` and pass the other domains' screens as constructor arguments from `main.dart`. `main.dart` would then decide which screen opens which, which is deciding rather than constructing, and every new tab still edits `deck`.
  - Make each tab a domain. A tab is a place on the screen, not a subject with its own lifecycle and vocabulary, which is what earns a domain (structure.md).
  - On the web, make the theme choice a feature, as the issue's draft target did. The app keeps the same choice in `design/`; a web feature is earned as a domain is, and the choice reads no server data and has no vocabulary beyond the design system's. Keeping it in `design/` on both clients is style.md's "Same problem, same solution shape".

## Decision

- **The app's top level is a closed list.** `app/lib/` holds these and nothing else, each with one responsibility:
  - `main.dart` — the composition site: constructs and passes, decides nothing else.
  - `home/` — the signed-in shell: the tabs, and every screen that shows more than one domain or leads from one domain into another, such as the home screen with the today card and the deck's page.
  - the domains `account/`, `deck/`, `study/`, `sync/`, `sharing/` and `photo_import/`, each its subject matter.
  - the foundations: `design/` (the tokens, colours, `ThemeData`, the user's theme choice and the domain-free components), `database/` (the drift database, its tables and its migration steps) and `l10n/` (the ARB files and the classes `gen-l10n` writes from them, at Flutter's default `arb-dir`).
- **The web's top level is a closed list.** `web/src/` holds these and nothing else:
  - `app/` — routes and the App Router files, and their `_components/` and `__tests__/`; the terms and the privacy policy in a `(legal)` route group.
  - `features/` — `account` (renamed from `auth`), `decks`, `study` and `legal`.
  - the foundations `design/` (the brand's marks, the skeleton, the theme choice and its store) and `supabase/` (the one vendor adapter).
  - `styles/` (the global stylesheet, the fonts link and the token tests), `testing/` (test infrastructure) and `__tests__/` (the tests of the root files).
  - the files `env.ts` and `proxy.ts`, which stack-nextjs §8 and §11 place there.
- **No top-level folder is named for a technical role.** `shared`, `common`, `utils`, `util`, `helpers`, `lib`, `components`, `ui`, `core`, `misc` and the like are refused at the top of `app/lib/` and `web/src/`. A new entry is added to the closed list by an ADR naming its one responsibility.
- **A foundation imports no domain and holds nothing that serves only one.** Nothing in a foundation imports a domain, a feature, `home/` or a route; foundations may import each other without a cycle. A file that only one domain or feature uses moves into it, and so does one that belongs to one's subject, which a sibling then reaches through its surface: `GoogleButtonStyle` moves to `account`, the web's study day time zone to `study`, and its card content blocks to `decks`, as the app's are `deck`'s. A foundation declares no surface file; a caller imports the file it uses.
- **A client module of one web feature takes a sibling's values from the server.** A client module cannot import a feature's `index.ts` that carries server-only code (stack-nextjs §13), so where `study`'s client components need what `decks` computes, such as a card side described as text, the server component that renders them passes it in.
- **The shell rule.** `home/` imports domain surfaces and foundations; nothing imports it except `main.dart`. A domain imports no screen of another domain. A screen that shows two domains, or opens one domain's screen from another's, belongs to `home/`, which builds it from the domains' exported widgets and hands values and callbacks between them, as a web route does. A domain widget with a place for something another domain draws takes it as a constructor argument from its caller in `home/`. `home/` holds no reads and no rules of its own: it composes.
- **The provider-seam rule.** A seam — a provider or interface a domain declares for something outside it to supply — exists only for a test double, an alternative implementation, or breaking an import cycle that a behaviour, not a screen, would otherwise create. It never lets one domain host another's screen or widget. A provider the composition site overrides with an instance of the domain's own type, such as `deckRepositoryProvider`, is a seam for a test double. `accountDataProvider`, through which `account` clears and reads what `sync` holds, breaks a behavioural cycle and stays.
- **Enforcement.**
  - `app/test/architecture_test.dart` fails on an entry under `app/lib/` outside the closed list; on an import from a foundation into a domain or `home/`; on an import of `home/` from anywhere but `main.dart`; on an import of a domain's `src/` from outside it (as before); and on a foundation file whose importers outside its folder all sit in one domain or all in `home/`.
  - `web/src/__tests__/structure.test.ts`, a Vitest test, fails on an entry under `web/src/` outside the closed list, with a control that a listed entry passes. ESLint's existing rule in `web/eslint.config.mjs` covers `src/design/`, `src/supabase/` and `src/env.ts`: none imports a feature or a route.
  - A class inside a foundation file that serves one domain, as `GoogleButtonStyle` did inside `theme.dart`, is not visible to either check; review holds it.
- **Supersedes:**
  - [ADR 0002](0002-domain-public-surface-and-shared-database.md)'s "Code below every domain lives under `app/lib/shared/`, the one folder under `app/lib/` that is not a domain", the database's and the ARB files' folders, the test's two rules as the whole check, and the departures "The database is in `app/lib/shared/`" and "The ARB files are in `app/lib/shared/l10n/`".
  - [ADR 0021](0021-type-and-spacing-scales-and-a-shared-component-layer.md)'s component folder `app/lib/shared/ui/` and theme file `app/lib/shared/theme.dart`, now `app/lib/design/`.
  - [ADR 0011](0011-shared-app-theme-bundled-font-and-today-builder.md)'s "Counts": `deck` declaring `TodayCount` and `todayProvider` and opening the session through `studyScreenProvider`. `study` exports its count, and `home/` lays it out.
  - [ADR 0017](0017-require-sign-in-through-an-account-gate.md)'s `signedInHomeProvider`: `main.dart` passes the signed-in home to `AccountGate` as a constructor argument.
  - [ADR 0020](0020-public-decks-in-a-sharing-domain.md)'s "Seam in deck": `home/` reaches `sharing` through its surface.
  - [ADR 0015](0015-sync-protocol-and-conflict-policy.md)'s `syncStatusProvider`: `home/` hands `sync`'s status view to the account screen. Its `accountDataProvider` stands.
  - [ADR 0019](0019-web-app-stack-portability-and-sign-in.md)'s `web/src/lib/` below every feature and its client construction through `web/src/lib/supabase/`, now `web/src/supabase/`.
  - [ADR 0024](0024-one-voice-and-a-sheet-action-rule.md)'s placement of the Google button's colours in `app/lib/shared/theme.dart`; they move to `account`, and the colour-literal check lists that file as its one exception beside the theme.

## Consequences

- Every top-level folder answers "what is this for" in its name, and a file that fits none of them has to earn a new entry in an ADR rather than land in a catch-all.
- A new tab is a screen in `home/`; no domain gains a provider slot for it.
- `deck` stops knowing `study`, `account`, `photo_import` and `sharing`: six providers and the `DeckSharing` interface leave it. `home/` becomes the one place where domains meet on screen, so a reviewer reads it for composition only.
- The app's dependency graph keeps its direction: `home/` above the domains, the foundations below them, `main.dart` above everything.
- On the web the routes already are the shell; the change there is folder names, the `auth` rename and the `(legal)` group, with no change of shape.
- The moves are mechanical but touch most files' imports; they are sequenced after the in-flight feature work that edits the same files, and until each lands, structure.md lists what is not yet moved.
- The single-domain rule becomes partly mechanical: a whole file serving one domain fails the test. A class inside a shared file still needs review.
- The closed lists are app and web only. `supabase/functions/_shared/` is Supabase's documented name for code shared between Edge Functions and is outside them.

## Signs the decision was wrong

- `home/` grows reads, rules or state of its own, or a domain change routinely needs an edit in `home/`: the shell has become a domain without a name.
- Domain widgets grow constructor parameters that only `home/` passes, in numbers that make a screen's parts harder to read than the provider slots were.
- Files are put in a foundation and imported by one domain plus a test-only second user to pass the check.
- A responsibility keeps arriving that fits no listed folder, and the closed list grows an entry per issue.
- The web's `design/` and the app's `design/` drift apart in what they hold, so the shared name stops telling a reader where the same thing lives.
