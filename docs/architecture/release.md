# Release

The iOS app's release: the `release` workflow that builds the app from a version tag and uploads it to TestFlight, how to cut a release, and what the owner does in App Store Connect afterwards. The checks every change runs are `ci.yml`'s. Android has no release yet.

## Current decisions

### What a tag does

- A pushed tag `v<major>.<minor>.<patch>`, or one named in Actions → release → Run workflow, starts `.github/workflows/release.yml` on `macos-26` with Xcode 26.6 ([ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-the-app-store-connect-api-key-alone.md)).
- `make release-check` refuses every name of another form. It also refuses a tag unless main holds its commit, and unless that commit's `(#N)` subject names a pull request that merged as it, whose head held the same tree and passed `ci (ubuntu)` and `ci (macos)`.
- `make release-ios` builds the tagged commit for release with `--dart-define-from-file=config/dev.json`, the configuration every build is given, which reaches `api.knowno.app`. The version is the tag's, and the build number is the run number plus 1. The app is signed for App Store distribution through the App Store Connect API key alone, and exported. The export must hold that version and build number, pass `codesign --verify --strict` and carry every entitlement of `app/ios/Runner/Runner.entitlements`.
- `make release-upload` uploads the ipa to App Store Connect with `xcrun altool --upload-package --wait`, which returns once Apple has processed it.
- The steps are `scripts/release-ios.ts`, under its grant in `scripts/grants.txt`. Its tests are `scripts/release-ios_test.ts`.

### Secrets

- The workflow reads `APP_STORE_CONNECT_KEY_P8` (the `.p8`'s contents), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and `APPLE_TEAM_ID` from the repository secrets.
- The key is written to the runner's temporary directory, mode 600, only for the step that signs or uploads. Its contents leave the environment before any tool starts, and the file is deleted when the step ends. An `if: always()` step removes the directory.
- The repository holds no key, certificate, profile, team or export options. `project.pbxproj` holds no signing team: the team is passed at build time.

### Dry run

- A pull request that changes `.github/workflows/release.yml` or `scripts/release-ios.ts` runs the same job with no tag. It builds, signs and checks the app as 0.0.0, and skips the check and the upload. It is not a required check.
- Pull requests from forks and from Dependabot get no secrets and skip the job. The next release runs Dependabot's moved pins.

### Cutting a release

1. Land the release's changes on `main` through pull requests.
2. Tag a commit of `main` and push the tag: `git tag v1.0.1 <commit>` and `git push origin v1.0.1`. Or run the `release` workflow by hand with that tag.
3. Watch the run. A refused tag uploads nothing. Delete it, fix what the refusal names, and tag again.
4. A rerun of a failed job keeps its run number. A version whose upload succeeded needs a new run, since App Store Connect refuses a build number twice.

### In App Store Connect afterwards

- The build appears under TestFlight once processed. Internal testers can install it.
- External testers need it added to their group, and the first build of a version goes through beta review.
- Export compliance is answered by `ITSAppUsesNonExemptEncryption` `false` in `app/ios/Runner/Info.plist`.
- Submitting for App Review stays the owner's: create the version, choose the build, write its notes, and submit.

## Rationale

- [ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-the-app-store-connect-api-key-alone.md) records the documentation read, why the app is archived with `xcodebuild` and the key rather than `flutter build ipa`, and why `altool --upload-package` uploads it. It also records why a tag must come from a pull request that passed CI on the same tree, why the build number is the run number plus 1, and why App Review stays manual.

## Open questions

- The key in the secrets on 2026-11-04 cannot export. #741's dry run archived with it and then failed with "Cloud signing permission error" (ADR 0192). A user's report on Apple's forums says only an Admin key reaches cloud-managed distribution certificates. Until the owner replaces the key with one that does, or the repository holds a distribution certificate, no release uploads.
- The archive signs with an "Apple Development: Created via API" certificate on a runner whose keychain starts empty. Whether that adds a certificate to the team's account on every run is unknown: the account's Certificates list shows it.
