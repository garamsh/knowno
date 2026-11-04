# Release

The iOS app's release: the `release` workflow that builds the app from a version tag and uploads it to TestFlight, the environment that holds its keys, the signing it does through Codemagic CLI tools, how to cut a release, and what the owner does in App Store Connect afterwards. The checks every change runs are `ci.yml`'s. Android has no release yet.

## Current decisions

### What a tag does

- A pushed tag `v<major>.<minor>.<patch>`, or the workflow run by hand from such a tag (Actions → release → Run workflow, "Use workflow from" the tag), starts the job `release` in `.github/workflows/release.yml` on `macos-26` with Xcode 26.6 ([ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md)).
- `make release-check` refuses every name of another form. It also refuses a tag unless:
  - `main` holds its commit;
  - that commit's `(#N)` subject names a pull request that merged as it;
  - that pull request's head held the same tree;
  - and that head's latest `ci (ubuntu)` and `ci (macos)` runs from GitHub Actions (app 15368, as branch protection requires) succeeded.
- `make release-ios` signs and builds the tagged commit, following Flutter's "Create a build archive with Codemagic CLI tools":
  1. `keychain initialize` creates a signing keychain under the runner's temporary directory.
  2. `app-store-connect fetch-signing-files app.knowno --type IOS_APP_STORE --create` fetches the App Store profile and the distribution certificate made from `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, creating either where none exists.
  3. `keychain add-certificates` adds the certificate to the signing keychain.
  4. `xcode-project use-profiles` applies the profile, on the runner only.
  5. `flutter build ipa --release --dart-define-from-file=config/dev.json` builds the ipa. That is the configuration every build is given, which reaches `api.knowno.app`. The version is the tag's, and the build number is the run number plus 1.
- The ipa must hold that version and build number, pass `codesign --verify --strict` and carry every entitlement of `app/ios/Runner/Runner.entitlements`.
- `make release-upload` runs `app-store-connect publish` on the ipa.
- `make release-cleanup` runs in an `if: always()` step. It runs `keychain use-login`, deletes the signing keychain with `keychain delete`, and removes the steps' files.
- The steps are `scripts/release-ios.ts`, under its grant in `scripts/grants.txt`. Its tests are `scripts/release-ios_test.ts`.
- Codemagic CLI tools are a uv project in `tools/release/`, pinned with each file's hash by `tools/release/uv.lock`. The program runs them with `uv run --project <repository>/tools/release --locked` with the project by absolute path, since a tool runs from `app/`, as `tools/fonts/` is run, and Dependabot's `uv` entry for `/tools/release` moves them.

### Concurrency

- Runs share a group per pull request and per tag.
- A new push to a pull request cancels its dry run in progress. A release in progress is never cancelled.
- GitHub cancels a pending run when a newer one joins its group, so a newer run of the same tag cancels an older pending one.
- Releases of different tags run side by side.

### The environment and its secrets

- The job `release` runs in the GitHub environment `release`. Its deployment rule admits only tags matching `v*`, so no branch, and no pull request, reaches the environment's secrets.
- It reads four secrets from that environment:
  - `APP_STORE_CONNECT_KEY_P8`, the `.p8`'s contents, from a key with the App Manager role;
  - `APP_STORE_CONNECT_KEY_ID`;
  - `APP_STORE_CONNECT_ISSUER_ID`;
  - `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, an RSA 2048 private key in PEM, from which the distribution certificate is made.
- **Key files:** each key is written to the runner's temporary directory, mode 600, only for the step that needs it. Its contents leave the environment before any tool starts.
- **Removal:** every key file is removed when the step ends. A removal that fails is reported and fails the step, after the step's own error.
- **Fetched certificates:** they are deleted once they are in the signing keychain.
- **The signing keychain:** it holds the certificate's private key from `make release-ios` until `make release-cleanup` deletes it at the end of the job.
- The repository holds no key, certificate, profile, team or export options. `project.pbxproj` holds no signing settings: `xcode-project use-profiles` writes them on the runner alone.

### The distribution certificate

- A run creates a distribution certificate only where the team holds none signed by `IOS_DISTRIBUTION_CERT_PRIVATE_KEY`, so every run after the first reuses one. The team's is `SXTR5TZ9RY`, with the App Store profile `MQNKD5L8P3`. #741's dry run created both through the App Manager key (run 41825198633, 2026-11-04), and the next run reused them (run 41826451786).
- A standard account holds at most 3 distribution certificates, by Codemagic's help article (ADR 0192). If the team holds 3 and none matches the key, the run fails before signing with "You already have a current Distribution certificate or a pending certificate request". The owner deletes an unused certificate in the developer portal.
- An expired certificate that Apple still lists would be reused and fail signing. Revoking it lets the next run create a new one from the same key.

### Dry run

- A pull request runs the job `dry-run` when it changes any of these: `.github/workflows/release.yml`, `Makefile`, `scripts/release-ios.ts`, `scripts/grants.txt`, `scripts/process.ts`, `scripts/run.sh` or `tools/release/`.
- The job runs in no environment and reads no secret:
  - it installs the locked tools with `uv sync --locked`;
  - `make release-ios` with no tag runs `xcode-project --version` through the locked tools from `app/`, the directory the signed build runs them from, so a tool path that fails there fails in the pull request;
  - `make release-ios` with no tag builds the app unsigned as 0.0.0 with `flutter build ipa --no-codesign`;
  - it checks the archive's version and build number.
- So it runs on pull requests from forks and Dependabot too. It signs and uploads nothing, so signing is tested only by a release. It is not a required check.

### Cutting a release

1. Land the release's changes on `main` through pull requests.
2. Tag a commit of `main` and push the tag: `git tag v1.0.1 <commit>` and `git push origin v1.0.1`. Or run the `release` workflow by hand from that tag.
3. Watch the run. A refused tag uploads nothing. Delete it, fix what the refusal names, and tag again.
4. A rerun of a failed job keeps its run number. A version whose upload succeeded needs a new run, since App Store Connect refuses a build number twice.

### In App Store Connect afterwards

- The build appears under TestFlight once processed, and Apple emails when it does. Internal testers can install it.
- External testers need it added to their group, and the first build of a version goes through beta review.
- Export compliance is answered by `ITSAppUsesNonExemptEncryption` `false` in `app/ios/Runner/Info.plist`.
- Submitting for App Review stays the owner's: create the version, choose the build, write its notes, and submit.

## Rationale

- [ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md) records:
  - the documentation read, and why signing follows Flutter's Codemagic CLI tools section rather than cloud signing, fastlane match or Xcode Cloud;
  - why the keys live in an environment only `v*` tags reach, and why the dry run builds unsigned;
  - why a tag must come from a pull request that passed CI on the same tree;
  - why the build number is the run number plus 1, and why App Review stays manual.

## Open questions

- None.
