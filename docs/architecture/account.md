# Account

The `account` domain: signing in with Google through Supabase Auth, the session it starts, deleting the account, and the configuration it reads.

## Current decisions

### Surface and location

- The domain lives in `app/lib/account/`; its public surface is `app/lib/account/account.dart`, with internals under `app/lib/account/src/` ([ADR 0002](adr/0002-domain-public-surface-and-shared-database.md)).
- The surface exports:
  - `connectAccount`, which returns an `AccountConnection`: the service, and the `SupabaseClient` it signs in through, null when the configuration cannot sign anyone in; and `accountDefines`;
  - `AccountService`, which signs in, signs out and deletes the account, and `accountServiceProvider`, which the composition site overrides;
  - the state: `AccountState`, `SignedOut`, `SignedIn` with the account's `UserId`, `AccountUnavailable`;
  - `AccountData`, `AccountDataNotCleared` and `accountDataProvider`, the device's data that sign-out pushes and clears, which the composition site overrides with the `sync` domain's, so this domain does not depend on it, a seam that breaks a behavioural cycle ([`sync.md`](sync.md));
  - the failures: `AccountFailure`, `AccountOffline`, `AccountMisconfigured`, `AccountRejected`;
  - `AccountGate`, the app's home, which takes the app it opens while signed in as a constructor argument: the composition site passes `home/`'s `HomeScreen`, so this domain depends on no other ([ADR 0017](adr/0017-require-sign-in-through-an-account-gate.md), [ADR 0039](adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md));
  - `AccountScreen`, the settings screen, which takes the sync status and the study settings' rows it shows as constructor arguments, and `AccountAvatar`, the account's initial in a circle, which the 오늘 tab draws;
  - `appVersionProvider`, the version the settings screen names, which the composition site overrides.
- It is the only domain that imports `google_sign_in` ([ADR 0006](adr/0006-account-native-google-sign-in.md)). `sync` and `sharing` also import `supabase_flutter`, for PostgREST with the client `connectAccount` returns ([ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md), [ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md)).
- `home/`'s home screen shows `AccountAvatar` on its account button, named "설정", and opens `AccountScreen` with `sync`'s `SyncStatusView`, and `study`'s `DailyMinutesRow`, `study`'s `AutoplayAudioRow` and `deck`'s `PartOfSpeechPresetsRow`, in that order, as its study settings' rows ([`home.md`](home.md)).

### Gate

- Sign-in is required: `AccountGate` shows `SignInScreen` while the state is `SignedOut` or `AccountUnavailable`, and the app only while it is `SignedIn` ([ADR 0017](adr/0017-require-sign-in-through-an-account-gate.md)).
- The gate shows the state the service holds now and never waits on the network: a session restored at start opens the app offline, expired or not, while its refresh runs in the background.
- When the state leaves `SignedIn`, by sign-out or by the client dropping the session, the gate closes every screen opened over the app, so the sign-in screen is the only one left.
- `SignInScreen` is the app's welcome ([ADR 0027](adr/0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md)): the stacked lockup, 200 wide and read as the app's name, with the two lines "밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드", centred on a ground-coloured panel whose bottom corners are rounded 40; below it, in thumb reach, Google's "Google로 계속하기" button and, quieter, a disabled "Apple로 계속하기 · 준비 중" text button that Apple sign-in (M4b) fills; then "계속하면 이용약관과 개인정보 처리방침에 동의하는 것으로 봐요." over the two links. With `AccountUnavailable` it shows the misconfiguration message in place of the buttons, and no app runs.
- The Google button is Google's own, drawn to its branding guidelines in the light or dark variant of the theme, with the "G" mark from Google's asset bundle ([`design.md`](design.md), [ADR 0024](adr/0024-one-voice-and-a-sheet-action-rule.md)).
- `AccountScreen` is reached only from the app, so it shows the signed-in account, the study settings, the theme, sign-out and deletion. It is titled "설정", and each section is a muted section label over one `AppGroup`, its rows split by hairlines ([ADR 0118](adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md)):
  - "계정": the email with the sync status under it, its words alone, with a spinner only while syncing ([ADR 0116](adr/0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md)), then "로그아웃";
  - "학습", the study settings' rows it is given: the daily study minutes' row, which opens their picker as a screen, the one place they change after the first-run step, then "앞면 소리 자동 재생" with its switch, then "라벨", which opens the labels the card editor offers ([`deck.md`](deck.md)) ([ADR 0086](adr/0086-show-and-change-the-daily-study-minutes-on-the-today-card-the-completion-card-a-one-time-first-run-step-the-account-screen-and-the-web-s-today-page.md), [ADR 0091](adr/0091-draw-the-today-card-as-a-progress-bar-and-change-the-daily-study-minutes-only-in-settings.md), [`study.md`](study.md));
  - "화면": "테마" with the current choice and a chevron;
  - then, in a group of its own with no label, "계정 삭제", a destructive `AppListRow` with no second line: its consequence is said by its confirmation alone;
  - a foot, centred and muted on one line: "버전 x.y.z", "이용약관" and "개인정보 처리방침", the two links, split by "·". The screen draws no avatar and no mascot.

### Sign-in and session

- Sign-in opens the platform's Google account picker (`GoogleSignIn.authenticate`), then passes the Google ID token and an access token for `email` and `profile` to Supabase's `signInWithIdToken`.
- Each run draws one random nonce when it initializes Google Sign-In: Google receives its SHA-256 as hex and puts it in the ID token, and `signInWithIdToken` receives the raw value, which Supabase checks against the token. Every sign-in in a run carries the same nonce, since Google Sign-In is initialized once per run ([ADR 0008](adr/0008-google-sign-in-nonce.md)).
- `supabase_flutter` stores the session on the device and restores it at start; the app then opens past the gate.
- Sign-out first asks `AccountData` to push every unsynced change. When some did not arrive, a confirmation sheet, "동기화하지 않고 로그아웃할까요?", offers "취소", which keeps the account signed in, and "그래도 로그아웃".
- It then ends the Supabase session on the device, tells the server, and signs out of Google so the next sign-in shows the picker again. Once the device is signed out, even after a failure telling the server, `AccountData` clears the device's data; a failure there is shown in a snack bar.
- The state is `SignedOut`, `SignedIn` with the account's email, or `AccountUnavailable` when the build's configuration cannot sign anyone in.

### Deletion

- "계정 삭제" asks first through `showAppConfirm`: "계정을 삭제할까요?", one sentence saying the decks, cards and study history go from the server and this device while decks others copied and the Google account stay, then "취소" and, last, a red "삭제" ([ADR 0026](adr/0026-delete-the-account-through-an-edge-function.md)).
- `AccountService.deleteAccount` posts to the `delete-account` Edge Function through the Supabase client's Edge Functions client, which sends the session's access token; the request names no user. The function first deletes the user's media files from the `media` bucket through the Storage API, then deletes the token's user, and the server's cascade deletes every row it owns ([`server.md`](server.md), [ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).
- Once the account is deleted, the screen signs out of Supabase and Google and clears the device's data through `AccountData`, as sign-out does but without pushing first. The gate then shows the sign-in screen.
- A failed deletion changes nothing: the account stays signed in with its data.
- Merging the pull request that changes the function deploys it ([`server.md`](server.md) §Edge Function deploys); it lives in `supabase/functions/delete-account/` with its Deno tests, run by `make test` through `scripts/deno.sh` with Supabase Auth replaced by a fake `fetch`.

### Configuration

- `app/config/dev.json` holds the Supabase URL, `https://api.knowno.app`, the project's custom domain, the Supabase publishable key, the Google web client ID (passed as the server client ID) and the iOS client ID. The values are public. The Android client is matched by package name, `app.knowno`, and signing certificate, so no Android client ID is configured ([ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)).
- The iOS client is the one created for `sh.garam.smartman`, its bundle ID changed by the owner to `app.knowno`, so the old app's install can no longer sign in with Google.
- `make test`, `make build` and the README's `flutter run` pass the file with `--dart-define-from-file`; no Dart source holds a value.
- The values are parsed once at start. A missing or malformed value, or a key that is not a publishable key, makes the state `AccountUnavailable`, with the reasons in its `AccountMisconfigured`; the gate then shows the message and no app.
- The terms of service and the privacy policy are the web's pages, `https://knowno.app/terms` and `https://knowno.app/privacy` ([`web-legal.md`](web-legal.md)), constants in `app/lib/account/src/legal.dart` that no configuration changes. Each link opens its page in the platform's browser through `url_launcher`, with a snack bar when it does not open ([ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md)).
- The app's version comes from the platform through `package_info_plus`, read once before the first frame.
- `app/ios/Runner/Info.plist` holds the reversed iOS client ID as a URL scheme. `scripts/check-ios-client-id.sh`, run by `make lint`, fails when it differs from `app/config/dev.json`.
- `scripts/check-secrets.sh`, run by `make lint`, fails when any file the repository tracks or would track holds a Supabase secret key or service-role key.
- The Swift packages `google_sign_in_ios` brings are pinned in the committed `Package.resolved` files under `app/ios/` ([ADR 0006](adr/0006-account-native-google-sign-in.md)).
  - `.github/dependabot.yml` has no `swift` entry for them. Dependabot's `swift` updater reads an Xcode project's `Package.resolved` (`swift/lib/dependabot/swift/file_fetcher.rb` in dependabot-core at `3ac9b7af9e729e80c8d1ddfbf6ae3839675fa77e`). It takes the requirements from the `XCRemoteSwiftPackageReference` entries of `project.pbxproj` (`file_parser/pbxproj_parser.rb`, same revision), and `app/ios/Runner.xcodeproj/project.pbxproj` has none: it names only `FlutterGeneratedPluginSwiftPackage` under `app/ios/Flutter/ephemeral/`, which git ignores. Without those requirements, Dependabot would move the pins past what `google_sign_in_ios` accepts.
  - The mover is the PM. To re-resolve within the current requirements: delete both `Package.resolved` files, then in `app/` run `flutter build ios --config-only --no-codesign --dart-define-from-file=config/dev.json`, which rewrites the copy under `Runner.xcodeproj/`, and `xcodebuild -resolvePackageDependencies -workspace ios/Runner.xcworkspace -scheme Runner`, which rewrites the one under `Runner.xcworkspace/`. Commit both.
- Only the `dev` environment exists; flavors wait for M7 ([ADR 0006](adr/0006-account-native-google-sign-in.md)).

### Failures

- Cancelling the picker is not a failure: sign-in returns and nothing is shown.
- Each expected failure is an `AccountFailure`:
  - `AccountOffline` — Supabase could not be reached, or answered with a server error;
  - `AccountMisconfigured` — the configuration is missing or malformed, Google reports a client or provider configuration error, or Supabase has the Google provider disabled;
  - `AccountRejected` — Google or Supabase refused, the ID token included;
  - `AccountSuspended` — Supabase Auth answered `user_banned`, since an admin suspended the account; its message says so and where to write ([ADR 0072](adr/0072-suspend-a-user-through-supabase-auth-s-ban-and-restrictive-write-policies-remove-a-public-deck-from-sharing-for-good-and-read-any-deck-in-the-admin-area.md)).
- A deletion that never reached the function, or that it answered with a 5xx, is `AccountOffline`; any other refusal, or a success other than 204, is `AccountRejected`.
- The sign-in screen shows a failure from sign-in, and the settings screen one from sign-out or deletion, in a snack bar, as a localized message; a rejected deletion says the account could not be deleted. Any other error propagates.
- A background refresh that cannot reach Supabase is left to the client, which keeps the session and retries; any other refresh error goes to `FlutterError.reportError`.

### Interface

- Every string comes from the shared ARB set. The buttons, the sign-out row and the deletion row are labelled by their text; the Google mark and the avatar are excluded from semantics, the Apple slot is read out as a disabled button, the section labels are headings, the app's name on the sign-in screen is a heading, and the progress indicator shown while signing in or out, or deleting, carries a semantic label.
- The settings screen's "테마" row opens a sheet, "테마", of 시스템, 라이트 and 다크, the current one read as selected with a check in ink; a choice applies at once and closes the sheet, and a dismissal keeps the theme. The choice belongs to the shared theme ([`design.md`](design.md)); this screen only shows it.

### Tests

- `app/test/account/account_gate_test.dart` composes the app through `composeApp`: signed out shows only the sign-in screen; signing in opens the home screen; signing out returns to the gate; signing out, and deleting the account, from the settings screen the gate closes mid-flow still clear the device's database; each screen over the home screen closes when the session ends; a restored, expired session opens the home screen over a Supabase Auth client whose server never answers, with signed out as the control; and an unavailable build shows the message.
- `app/test/account/sign_in_screen_test.dart` drives the sign-in screen with a substitute `AccountService` (`app/test/account/fake_account_service.dart`): the welcome, the logo in the upper part and the buttons below it, the terms sentence with its two links, each opening its web page through a substitute opener, and a link that does not open saying so, the progress while signing in, a cancelled sign-in, each failure, the disabled Apple slot below Google's button, and Google's light and dark buttons with the mark and the label, meeting the tap target and contrast guidelines in both themes.
- `app/test/account/account_screen_test.dart` drives the settings screen with the same substitute and an `AccountData` (`app/test/account/fake_account_data.dart`): its title, the order of the sections with the email and sign-out in one group and the deletion in another, no avatar, the theme row's sheet applying a choice and a dismissal keeping it, the foot's one centred line below the deletion with no image, and its links opening their web pages, sign-out with and without unsynced changes, a failed clear, a failed sign-out, the sync status shown only while signed in, and deletion: the red row with no second line, the confirmation, cancelling, deleting without a push, each failure, a failed clear, and the tap target and contrast guidelines in both themes.
- `app/test/account/account_service_test.dart` runs the real service over a substitute Google Sign-In platform and a Supabase Auth client whose HTTP client is substituted. It checks that the raw nonce sent to Supabase hashes to the one Google was given, and that each start draws a new one; that Auth's `user_banned` is `AccountSuspended`, against another refusal; and, over a substituted Edge Functions client, that deletion posts no body and maps each answer to its failure.
- `app/test/account/suspension_test.dart` runs against the local stack `scripts/test-sync.sh` starts: an admin suspends a user through `admin_suspend_user`, whose refresh, sign-in and sync push are then refused, `user_banned` for the first two, while an active user's push and refresh succeed; after `admin_unsuspend_user` the user signs in and pushes again. Without the stack the plain `flutter test` run skips the file with its reason.
- `app/test/account/config_test.dart` covers the configuration's parsing, and checks that `app/config/dev.json` parses.

## Rationale

- [ADR 0118](adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) records why the screen is titled 설정 and drawn as grouped sections, why the theme is a row with a sheet, and why the deletion row has no note.
- [ADR 0006](adr/0006-account-native-google-sign-in.md) records the native flow, the sources it follows, the configuration approach, the duplicated URL scheme, and why flavors wait for M7.
- [ADR 0008](adr/0008-google-sign-in-nonce.md) records which platform sources show the nonce reaching the ID token, and why it is drawn per run rather than per sign-in.
- [ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md) records why sign-out pushes and clears the device's data, and why the client reaches `sync`.
- [ADR 0017](adr/0017-require-sign-in-through-an-account-gate.md) records why sign-in is required, how the gate closes the app's screens, and why it never waits on the network.
- [ADR 0039](adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md) records why the gate and the account screen take the app and the sync status from their callers rather than through providers the composition site overrides.
- [ADR 0026](adr/0026-delete-the-account-through-an-edge-function.md) records why deletion goes through an Edge Function that deletes only the token's user, and why it clears the device without pushing.
- [ADR 0027](adr/0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) records the sign-in and account screens' v2 design.
- [ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md) records why the legal links are the web's pages and not configuration.
- [ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md) records the name, the bundle and package ID `app.knowno`, the legal pages' host, the Supabase URL and the iOS client re-pointed to `app.knowno`.
- [ADR 0072](adr/0072-suspend-a-user-through-supabase-auth-s-ban-and-restrictive-write-policies-remove-a-public-deck-from-sharing-for-good-and-read-any-deck-in-the-admin-area.md) records why a suspension is Supabase Auth's ban, which refuses the sign-in and refresh.
- Issue #15 records the decisions made by the PM, issue #20 the nonce, issue #28 the gate, issue #26 deletion, and issue #72 the v2 screens, and issue #86 the legal documents.

## Open questions

- None.
