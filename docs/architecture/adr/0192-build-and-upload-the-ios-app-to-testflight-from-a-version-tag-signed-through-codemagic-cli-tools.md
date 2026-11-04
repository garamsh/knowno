# ADR 0192: Build and upload the iOS app to TestFlight from a version tag, signed through Codemagic CLI tools

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #738.** No workflow ran on a tag. `ci.yml` builds the iOS app for the simulator, unsigned.
  - The PM built TestFlight's 1.0.0 (1) by hand on 2026-11-04. `flutter build ipa` archived the app on a Mac signed into Xcode. The PM exported with `xcodebuild -exportArchive -allowProvisioningUpdates` and uploaded with `xcrun altool --upload-app`.
  - A CI runner has no Xcode account. The repository holds an App Store Connect API key with the App Manager role as `APP_STORE_CONNECT_KEY_P8`, `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`.
  - On 2026-11-04 the owner chose Codemagic CLI tools, keeping that key, and set `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, an RSA 2048 private key in PEM.
- **What the documentation says** (each read 2026-11-04):
  - Flutter's [Build and release an iOS app](https://docs.flutter.dev/deployment/ios) was updated 2026-07-31 for Flutter 3.47.
    - Its section "Create a build archive with Codemagic CLI tools" uses an App Store Connect API key with App Manager access. It gives a distribution certificate's private key, made by `ssh-keygen -t rsa -b 2048 -m PEM`, to `app-store-connect fetch-signing-files <bundle id> --platform IOS --type IOS_APP_STORE --certificate-key=… --create`. The certificate "will be created from the private key if it doesn't exist in App Store Connect".
    - It then runs `keychain initialize` and `keychain add-certificates`. Next, `xcode-project use-profiles`, whose output is the export options. Then `flutter build ipa --release --export-options-plist=…`, then `app-store-connect publish --path <ipa>`.
    - It says that after `keychain initialize` you "must" run `keychain use-login`.
    - The same page sets the version with `--build-name` and `--build-number`.
  - Codemagic CLI tools 0.70.2 (PyPI and GitHub release, 2026-10-29) document their options in `docs/` at tag `v0.70.2`:
    - `fetch-signing-files` takes `--certificate-key`, `--private-key`, `--issuer-id` and `--key-id`, each as `@file:` or `@env:`. It also takes `--certificates-dir`, `--strict-match-identifier`, `--create` and `--disable-jwt-cache`.
    - `keychain add-certificates` takes `--certificate` as a path or glob.
    - `xcode-project use-profiles` takes `--project` and `--export-options-plist`.
    - `publish` takes `--path` and uploads through `altool`.
  - In the same release, `fetch_signing_files_action.py` and `certificates_action_group.py` list the team's certificates of the profile's types and keep those signed by the given key. Only where none is kept does `--create` request a new certificate from that key. They filter on nothing else, expiry included.
  - Apple's [Certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview/) says "only the Account Holder or Admin role can create distribution certificates".
  - Codemagic's help article ["Why is my iOS build failing with 'You already have a current Distribution certificate or a pending certificate request'?"](https://help.codemagic.io/articles/8788065850-why-is-my-ios-build-failing-with-you-already-have-a-current-distribution-certificate-or-a-pending-certificate-request) puts Apple's limit at 3 distribution certificates on a standard Apple Developer Program account. When none matches the key at the cap, Apple refuses the new one with that error. The remedy is to delete one in the developer portal: those made through the API are labelled "Created via API".
  - Flutter's [Continuous delivery with Flutter](https://docs.flutter.dev/deployment/cd), updated 2026-07-31, gives two other routes:
    - fastlane, whose CI host gets its distribution certificate through fastlane match.
    - Xcode Cloud, with a `ci_scripts/ci_post_clone.sh` that installs Flutter on Apple's hosts.
  - Branch protection on `main` requires `ci (ubuntu)` and `ci (macos)` and an up-to-date branch, so a squash merge lands the tree its pull request's head held.
    - On 2026-11-04 the head of #730 and main's `c838156cd329598cb10b0802ba6bdd8b9e91fbbc` both held tree `d64251733c77f74c395d08ffc5364b5dfa7f7962`.
    - On the same day, GitHub's `commits/{sha}/pulls` and GraphQL `associatedPullRequests` returned no pull request for that commit.
- **This pull request's first dry run** (run 41818551017, 2026-11-04, on #741) tried cloud signing with the App Manager key: `xcodebuild archive` and `-exportArchive` with `-allowProvisioningUpdates` and the key.
  - The archive succeeded, signed with "Apple Development: Created via API".
  - The export failed with "Cloud signing permission error" and "No signing certificate "iOS Distribution" found".
- **This pull request's dry run with Codemagic CLI tools** (run 41825198633, 2026-11-04, head `8b3e23c284e273aebe569b41e28ed3aa51890f52`) used the App Manager key and `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`.
  - `fetch-signing-files` found no distribution certificate signed by the key and created `SXTR5TZ9RY`. It then created the App Store profile `MQNKD5L8P3`.
  - `flutter build ipa` built `knowno.ipa`, which held 0.0.0 (4) and passed the ipa check with the Sign in with Apple entitlement.
  - `keychain use-login` ran in the cleanup step. The upload did not run.
- **Alternatives considered:**
  - **Cloud-managed signing through `xcodebuild` and the API key.** Run 41818551017 refused it under the App Manager key. Apple Developer Forums [thread 698117](https://developer.apple.com/forums/thread/698117) (January 2022, a user's report) says only an Admin key succeeds. An Admin key is a wider grant than releasing needs. Rejected.
  - **fastlane with match**, as Flutter's CD page shows. It keeps certificates in a separate store, a git repository or a bucket, behind a passphrase, and needs a Ruby toolchain. Rejected: the owner chose no certificate repository.
  - **Xcode Cloud**, as Flutter's CD page shows. It builds on Apple's hosts from workflows configured in App Store Connect, outside this repository's workflows and checks, so `release-check`'s gate and the dry run would have no place to run. Rejected.
  - **`flutter build ipa` with automatic signing.** It passes no authentication key to `xcodebuild` (Flutter 3.47.7's `packages/flutter_tools/lib/src/ios/mac.dart`), so it signs only through an account signed into Xcode. Rejected.
  - **`xcrun altool --upload-package`** to upload. Codemagic's `publish` runs `altool` itself, takes the same key from a file, and is the step Flutter's section shows. Not taken.
  - **A separate production configuration file.** `app/config/dev.json` is the only configuration and already names `api.knowno.app` ([ADR 0134](0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)). Not taken.

## Decision

- **A tag `v<major>.<minor>.<patch>` releases.**
  - The `release` workflow runs on a pushed tag of that form, or by hand through `workflow_dispatch` naming one.
  - `make release-check` refuses any other name, and any tag whose commit is not on `main`. It also refuses unless the pull request named by the commit's `(#N)` subject merged as that commit, its head held the same tree, and that head's latest `ci (ubuntu)` and `ci (macos)` succeeded.
- **The version is the tag's, and the build number is the workflow's run number plus 1.** It rises with every run and is above TestFlight's 1. Dry runs share the count.
- **Signing follows Flutter's Codemagic CLI tools section.** `make release-ios` runs, in order:
  1. `keychain initialize`.
  2. `app-store-connect fetch-signing-files app.knowno --platform IOS --type IOS_APP_STORE --create --strict-match-identifier`, with the certificate key and the API key as files and the IDs from the environment.
  3. `keychain add-certificates`.
  4. `xcode-project use-profiles`.
  5. `flutter build ipa --release --dart-define-from-file=config/dev.json --build-name=<tag's version> --build-number=<run + 1> --export-options-plist=<use-profiles' output>`.
  - `use-profiles` rewrites the project's signing settings on the runner only, and nothing commits them.
  - The job selects Xcode 26.6 through `DEVELOPER_DIR`.
- **The ipa is checked before anything uploads.** It must hold the tag's version and the build number, pass `codesign --verify --strict`, and be signed with every entitlement `app/ios/Runner/Runner.entitlements` grants.
- **`make release-upload` runs `app-store-connect publish --path <ipa>`** with the API key.
- **`make release-cleanup` runs `keychain use-login` in an `if: always()` step** and removes what the steps wrote.
- **The tools are pinned by hash.** `tools/release/requirements.txt` pins Codemagic CLI tools 0.70.2 and its 30 dependencies with hashes, compiled from `requirements.in` by `uv pip compile --generate-hashes`.
  - The job installs them with `pip install --require-hashes --no-deps` on Python 3.14.10 from `actions/setup-python` v7.1.0.
  - OSV reported no advisory for any of the 31 versions on 2026-11-04. Dependabot's `pip` entry moves them.
- **Each key exists only while a step needs it.** `scripts/release-ios.ts` writes the API key and the certificate key under the runner's temporary directory, mode 600. It removes their contents from the environment before any tool starts, and deletes the files when the step ends.
  - The certificates `fetch-signing-files` saves go to the same directory and are deleted once they are in the keychain.
  - Nothing is committed: no key, certificate, profile, team or export options, and no signing setting in `project.pbxproj`.
- **A pull request that changes the workflow, `scripts/release-ios.ts` or `tools/release/requirements.txt` runs a dry run.** It signs and builds the app as 0.0.0 and uploads nothing. Pull requests from forks and from Dependabot get no secrets and skip it.
- **App Review stays manual.** The owner chooses a build, writes its notes and submits it in App Store Connect.

## Consequences

- A release is a tag push, with no Mac of ours involved. The first is the PM's `v1.0.1` after this merges.
- One distribution certificate serves every run: the first run that finds none signed by `IOS_DISTRIBUTION_CERT_PRIVATE_KEY` creates it, and later runs find it.
- **The certificate cap.** If the team already holds 3 distribution certificates and none matches the key, `--create` is refused and the build fails before signing. The owner then deletes one in the developer portal.
- **Expiry.** The listing filters on the key alone, so an expired certificate still listed by Apple would be kept, and signing would fail. Revoking it lets the next run create a new one from the same key.
- Apple's help names Account Holder or Admin for creating distribution certificates. The App Manager key still created one through the API in run 41825198633, as Flutter's section implies it can.
- A tag on a commit that did not land through a pull request is refused, even if CI ran on it some other way.
- The upload depends on Codemagic CLI tools and the `altool` they call. A change to either reaches the release through a Dependabot pull request, whose dry run is skipped. It is therefore tested by the next pull request that touches the workflow, or by the next release.

## Signs the decision was wrong

- A later run creates a second certificate though `IOS_DISTRIBUTION_CERT_PRIVATE_KEY` is unchanged, so the match by key does not hold.
- Runs fail at the certificate cap again and again, because certificates made from other keys keep filling it.
- A tag on a commit with a passing pull request is refused because the tree check or the `(#N)` subject fails. Branch protection would then not hold what this decision relies on.
- A build reaches TestFlight but fails processing or runs without Sign in with Apple, though the ipa check passed.
