# ADR 0192: Build and upload the iOS app to TestFlight from a version tag, signed through the App Store Connect API key alone

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #738.** No workflow ran on a tag. `ci.yml` builds the iOS app for the simulator, unsigned. The PM built TestFlight's 1.0.0 (1) by hand on 2026-11-04. `flutter build ipa` archived the app on a Mac signed into Xcode. Exporting with the API key timed out, so the PM exported with `xcodebuild -exportArchive -allowProvisioningUpdates` and uploaded with `xcrun altool --upload-app`. A CI runner has no Xcode account. The repository holds the key and team as the secrets `APP_STORE_CONNECT_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and `APPLE_TEAM_ID`, and no certificate or profile.
- **What the documentation says** (each read 2026-11-04):
  - Flutter's [Build and release an iOS app](https://docs.flutter.dev/deployment/ios), updated 2026-07-31 for Flutter 3.47, says to build with `flutter build ipa` and set the version with `--build-name` and `--build-number`. It says to upload with `xcrun altool --upload-app --type ios -f <ipa> --apiKey <id> --apiIssuer <issuer>`, using an App Store Connect API key with App Manager access.
  - Flutter's [Continuous delivery with Flutter](https://docs.flutter.dev/deployment/cd), updated 2026-07-31, says to run `flutter build ios --release --no-codesign --config-only` on a CI host. It gives that host a distribution certificate through fastlane match.
  - Flutter 3.47.7's `flutter build ipa` passes `-allowProvisioningUpdates` to `xcodebuild` and no authentication key (`packages/flutter_tools/lib/src/ios/mac.dart` and `commands/build_ios.dart` in that release). So it signs only through an account signed into Xcode.
  - `xcodebuild -help` in Xcode 26.6 (17F113) says `-allowProvisioningUpdates` needs either an account in Xcode or an App Store Connect key passed as `-authenticationKeyPath`, `-authenticationKeyID` and `-authenticationKeyIssuerID`. With automatic signing, xcodebuild then creates profiles and certificates. Its export options include `method`, `destination` (`export` or `upload`), `signingStyle` and `teamID`. Exporting with `signingStyle` `automatic` creates "provisioning profiles and managed cloud signing certificates as necessary".
  - Apple's [Cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/) says Xcode 13 and later cloud-sign for distribution when no local signing certificate is found. It also says App Store Connect grants Admins and Developers the permission to sign with them. It names no role for an API key.
  - Apple Developer Forums [thread 698117](https://developer.apple.com/forums/thread/698117), January 2022, is a user's report and not Apple's documentation. In it, `-exportArchive` fails with "Cloud signing permission error" under a Developer or App Manager key and succeeds under an Admin key.
  - Apple's [altool guide](https://help.apple.com/asc/appsaltool/en.lproj/static.html), revised 2022-04-01, deprecates `--upload-app` for `--upload-package`. `xcrun altool --help` in Xcode 26.6 (altool 26.40.1) gives `--upload-package <file>` with only the authentication options: `--api-key`, `--api-issuer`, `--p8-file-path`, and `--wait`, which waits for processing.
  - Branch protection on `main` requires `ci (ubuntu)` and `ci (macos)` and that a branch is up to date before merging. A squash merge therefore lands the tree that its pull request's head held. On 2026-11-04 the head of #730 and main's `c838156cd329598cb10b0802ba6bdd8b9e91fbbc` both held tree `d64251733c77f74c395d08ffc5364b5dfa7f7962`. On the same day, GitHub's `commits/{sha}/pulls` and GraphQL `associatedPullRequests` returned no pull request for that commit, so they cannot yet name a fresh merge's pull request.
- **This pull request's dry run** (run 41818551017, 2026-11-04, on #741) used the repository's key on `macos-26` with Xcode 26.6:
  - `xcodebuild archive` succeeded from the key alone. It signed with "Apple Development: Created via API" and "iOS Team Provisioning Profile: app.knowno".
  - `-exportArchive` failed with "Cloud signing permission error", then "No signing certificate "iOS Distribution" found". That is the forum report's failure, so the key's role does not reach cloud-managed distribution certificates.
- **Alternatives considered:**
  - **`flutter build ipa`, as the PM built 1.0.0.** It passes no authentication key, so on a runner with no account it cannot sign. Rejected.
  - **fastlane match, or a distribution certificate and profile in the secrets.** Either needs a certificate store and secrets the repository does not have, and fastlane needs a Ruby toolchain. Not taken. A `.p12` is the remedy if signing creates a certificate on every run (open questions in `release.md`).
  - **`apple-actions/upload-testflight-build`** (v5.9.0, 2026-10-29), the maintained action for this step. It is a third-party bundle that would hold the key. By default it first checks TestFlight's test information and fails without it. Its releases came weekly in October. Apple's `altool`, part of the Xcode the job selects, does the same step with the same key. Not taken.
  - **`destination: upload` in the export options**, which signs and uploads in one `xcodebuild` call. A dry run could then not sign without uploading, so it would test a different step from a release. Rejected.
  - **`--upload-app`**, which Flutter's page shows. It is deprecated, and `--upload-package` takes the same file and key. Rejected.
  - **A separate production configuration file.** `app/config/dev.json` is the only configuration. It already names the production backend, `api.knowno.app` ([ADR 0134](0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)), so a second file would be a copy. Not taken. Renaming it is a change of its own.

## Decision

- **A tag `v<major>.<minor>.<patch>` releases.** The `release` workflow runs on a pushed tag of that form, or by hand through `workflow_dispatch` naming one. `make release-check` refuses any other name, and any tag whose commit is not on `main`. It also refuses unless the pull request named by the commit's `(#N)` subject merged as that commit, its head held the same tree, and that head's latest `ci (ubuntu)` and `ci (macos)` succeeded.
- **The version is the tag's, and the build number is the workflow's run number plus 1.** The run number rises with every run, so each upload's build number is higher than the last and above TestFlight's 1. Dry runs share the count and leave gaps.
- **The build is a release of the tagged commit with `--dart-define-from-file=config/dev.json`.** `make release-ios` runs `flutter build ios --release --no-codesign --config-only`, as Flutter's CD page shows, then `xcodebuild archive` with automatic signing for `APPLE_TEAM_ID`, then `xcodebuild -exportArchive` with `method` `app-store-connect`, `destination` `export` and `signingStyle` `automatic`. Both `xcodebuild` calls pass `-allowProvisioningUpdates` with the API key. The job selects Xcode 26.6 through `DEVELOPER_DIR`.
- **The export is checked before anything uploads.** The ipa must hold the tag's version and the build number, pass `codesign --verify --strict`, and be signed with every entitlement `app/ios/Runner/Runner.entitlements` grants.
- **`make release-upload` uploads with `xcrun altool --upload-package --wait`** and the same key.
- **The key exists only while a step needs it.** `scripts/release-ios.ts` writes it under the runner's temporary directory, mode 600. It removes the key's contents from the environment before any tool starts and deletes the file when the step ends. An `if: always()` step removes the directory. Nothing is committed: no key, certificate, profile, team or export options file, and no signing setting in `project.pbxproj`.
- **A pull request that changes the workflow or `scripts/release-ios.ts` runs a dry run.** It signs and exports the app as 0.0.0 and uploads nothing. Pull requests from forks and from Dependabot get no secrets and skip it.
- **App Review stays manual.** The owner chooses a build, writes its notes and submits it in App Store Connect. The workflow ends when the build reaches App Store Connect.

## Consequences

- A release is a tag push, with no Mac of ours involved. The first is the PM's `v1.0.1` after this merges.
- A tag on a commit that did not land through a pull request, such as a direct push to `main` or a merge commit, is refused, even if CI ran on it some other way.
- The API key must be allowed to use cloud-managed distribution certificates. By the forum report, that means an Admin key. The dry run is the first place a wrong role shows: `-exportArchive` fails with "Cloud signing permission error".
- Each run signs on a runner with an empty keychain, so automatic signing may create a certificate in the team's account every run, and nothing deletes it. The dry run's log shows whether it does.
- The upload depends on `altool` in the selected Xcode. When Apple removes it, the step moves to its replacement in a new ADR.
- Moving the Xcode in `DEVELOPER_DIR` moves the release build's toolchain. The PM moves it with `ci.yml`'s runner labels.

## Signs the decision was wrong

- Runs fail with "Maximum number of certificates", or the team's certificate list grows by one each run. A distribution certificate in the secrets would then have been the cheaper choice.
- An Admin key is refused for cloud signing too, so signing on CI needs a certificate the repository holds.
- A tag on a commit with a passing pull request is refused because the tree check or the `(#N)` subject fails. Branch protection would then not hold what this decision relies on.
- A build reaches TestFlight but fails processing or runs without Sign in with Apple, though the export check passed. The check would then cover less than signing does.
