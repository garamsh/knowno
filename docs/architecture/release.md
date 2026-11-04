# Release

The iOS app's release: the `release` workflow that builds the app from a version tag and uploads it to TestFlight, the signing it does through Codemagic CLI tools, how to cut a release, and what the owner does in App Store Connect afterwards. The checks every change runs are `ci.yml`'s. Android has no release yet.

## Current decisions

### What a tag does

- A pushed tag `v<major>.<minor>.<patch>`, or one named in Actions → release → Run workflow, starts `.github/workflows/release.yml` on `macos-26` with Xcode 26.6 ([ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md)).
- `make release-check` refuses every name of another form. It also refuses a tag unless:
  - `main` holds its commit;
  - that commit's `(#N)` subject names a pull request that merged as it;
  - that pull request's head held the same tree and passed `ci (ubuntu)` and `ci (macos)`.
- `make release-ios` signs and builds the tagged commit, following Flutter's "Create a build archive with Codemagic CLI tools":
  1. `keychain initialize`.
  2. `app-store-connect fetch-signing-files app.knowno --type IOS_APP_STORE --create` fetches the App Store profile and the distribution certificate made from `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, creating either where none exists.
  3. `keychain add-certificates`.
  4. `xcode-project use-profiles`, on the runner only.
  5. `flutter build ipa --release --dart-define-from-file=config/dev.json`, the configuration every build is given, which reaches `api.knowno.app`. The version is the tag's, and the build number is the run number plus 1.
- The ipa must hold that version and build number, pass `codesign --verify --strict` and carry every entitlement of `app/ios/Runner/Runner.entitlements`.
- `make release-upload` runs `app-store-connect publish` on the ipa. `make release-cleanup` runs `keychain use-login` and removes the step's files, in an `if: always()` step.
- The steps are `scripts/release-ios.ts`, under its grant in `scripts/grants.txt`. Its tests are `scripts/release-ios_test.ts`.
- Codemagic CLI tools and their dependencies are pinned with hashes in `tools/release/requirements.txt`, compiled from `tools/release/requirements.in` by the command its header names. The job installs them with `pip install --require-hashes --no-deps` on the Python release the workflow sets. Dependabot's `pip` entry for `/tools/release` moves them.

### Secrets

- The workflow reads these repository secrets:
  - `APP_STORE_CONNECT_KEY_P8`, the `.p8`'s contents, from a key with the App Manager role;
  - `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`;
  - `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, an RSA 2048 private key in PEM, from which the distribution certificate is made.
- Each key is written to the runner's temporary directory, mode 600, only for the step that needs it. Its contents leave the environment before any tool starts, and the file is deleted when the step ends. The certificates fetched there are deleted once they are in the keychain. The IDs reach the tools as `@env:` references.
- The repository holds no key, certificate, profile, team or export options. `project.pbxproj` holds no signing settings: `xcode-project use-profiles` writes them on the runner alone.

### The distribution certificate

- A run creates a distribution certificate only where the team holds none signed by `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, so every run after the first reuses one.
- A standard account holds at most 3 distribution certificates, by Codemagic's help article (ADR 0192). If the team holds 3 and none matches the key, the run fails before signing with "You already have a current Distribution certificate or a pending certificate request". The owner deletes an unused one in the developer portal.
- An expired certificate that Apple still lists would be reused and fail signing. Revoking it lets the next run create a new one from the same key.

### Dry run

- A pull request that changes `.github/workflows/release.yml`, `scripts/release-ios.ts` or `tools/release/requirements.txt` runs the same job with no tag. It signs, builds and checks the app as 0.0.0, and skips the check and the upload. It is not a required check.
- Pull requests from forks and from Dependabot get no secrets and skip the job. The next release runs Dependabot's moved pins.

### Cutting a release

1. Land the release's changes on `main` through pull requests.
2. Tag a commit of `main` and push the tag: `git tag v1.0.1 <commit>` and `git push origin v1.0.1`. Or run the `release` workflow by hand with that tag.
3. Watch the run. A refused tag uploads nothing. Delete it, fix what the refusal names, and tag again.
4. A rerun of a failed job keeps its run number. A version whose upload succeeded needs a new run, since App Store Connect refuses a build number twice.

### In App Store Connect afterwards

- The build appears under TestFlight once processed, and Apple emails when it does. Internal testers can install it.
- External testers need it added to their group, and the first build of a version goes through beta review.
- Export compliance is answered by `ITSAppUsesNonExemptEncryption` `false` in `app/ios/Runner/Info.plist`.
- Submitting for App Review stays the owner's: create the version, choose the build, write its notes, and submit.

## Rationale

- [ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md) records the documentation read and why signing follows Flutter's Codemagic CLI tools section rather than cloud signing, fastlane match or Xcode Cloud. It also records why a tag must come from a pull request that passed CI on the same tree, why the build number is the run number plus 1, and why App Review stays manual.

## Open questions

- None. The App Manager key created the team's distribution certificate `SXTR5TZ9RY` and the App Store profile `MQNKD5L8P3` from `IOS_DISTRIBUTION_CERT_PRIVATE_KEY` in #741's dry run (run 41825198633, 2026-11-04). Later runs reuse both.
