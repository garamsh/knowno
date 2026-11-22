# Release

The app's release: the `release` workflow that builds the app from a version tag and uploads it to TestFlight and to Google Play's internal track, the environment that holds its keys, the iOS signing it does through Codemagic CLI tools and the Android signing and upload through Gradle, the Google Cloud and Play access the upload uses, how to cut a release, and what the owner does in App Store Connect and Play Console afterwards. The checks every change runs are `ci.yml`'s.

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

### The Android release

- The same tag, in the same run, starts the job `release-android` on `ubuntu-24.04` in the environment `release` ([ADR 0266](adr/0266-sign-the-android-bundle-with-the-upload-key-and-upload-it-to-google-play-s-internal-track-from-the-version-tag-through-gradle-play-publisher-and-workload-identity-federation.md)). It runs beside the iOS job, and either fails alone.
- `make release-check` refuses a tag as it does for iOS.
- `make release-android` builds and checks the bundle, through `scripts/release-android.ts` under its grant in `scripts/grants.txt`, whose tests are `scripts/release-android_test.ts`:
  1. It writes the decoded `ANDROID_UPLOAD_KEYSTORE_BASE64` under the runner's temporary directory, mode 600, and drops the secret from the environment before any tool starts.
  2. `flutter build appbundle --release --dart-define-from-file=config/dev.json` builds the bundle. The version is the tag's, and the version code is the run number plus 1, the iOS build number.
  3. The bundle must have exactly one signer, `keytool -printcert -jarfile`'s, and its SHA-256 fingerprint must be the upload key's.
  4. The keystore is removed when the step ends. A removal that fails fails the step.
- `google-github-actions/auth` exchanges the job's OIDC token for the service account and writes an external-account credentials file, which `GOOGLE_APPLICATION_CREDENTIALS` names. The job alone has `id-token: write`.
- `make release-android-upload` runs `./gradlew :app:publishReleaseBundle` from `app/android/`. That task is gradle-play-publisher's, at the release `app/android/settings.gradle.kts` pins, configured in `app/android/app/build.gradle.kts`:
  - it uploads the bundle in `app/build/app/outputs/bundle/release/` without building it (`artifactDir`);
  - it commits a completed release to the `internal` track;
  - it authenticates through Application Default Credentials, which read that file.
- Nothing in the repository promotes a release, or names a track but `internal`.

### Android signing

- The release build type signs with the signing config `upload` alone. It reads `ANDROID_UPLOAD_KEYSTORE` (the keystore's path), `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` and `ANDROID_UPLOAD_KEY_PASSWORD` from the environment.
- A build whose tasks sign the release fails before any task runs while any of the four is unset, with "The release build signs only with the upload key" and the names. The tasks are `validateSigningRelease`, `signReleaseBundle` and `packageRelease`. So `flutter run --release` and `flutter build appbundle` need the four in the environment, and nothing falls back to the debug key.
- A debug build, `make build-apk` among them, signs with the debug key, and the upload signs nothing.
- Play App Signing signs what users download. The upload key only proves an upload is ours, and Play Console can reset it if it is lost.

### Google Cloud and Play access

- **The service account** is `github-actions-release@knowno-515411.iam.gserviceaccount.com`, in the Google Cloud project `knowno-515411`.
- **The workload identity pool** is `knowno-github-release`, and so is its OIDC provider: the form `<system>-<consumer>`, the consumer being this repository's release workflow.
  - The provider's issuer is `https://token.actions.githubusercontent.com`.
  - It maps `google.subject=assertion.sub`, `attribute.repository=assertion.repository` and `attribute.ref=assertion.ref`.
  - Its condition is `assertion.repository == 'garamsh/knowno' && assertion.ref.matches('^refs/tags/v[0-9]+[.][0-9]+[.][0-9]+$')`, so no other repository and no branch, pull request or other tag gets a token.
- `roles/iam.workloadIdentityUser` on the service account is bound to `principalSet://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/knowno-github-release/attribute.repository/garamsh/knowno`.
- In Play Console (Garam Apps), the service account holds one app permission on `app.knowno`, "Release apps to testing tracks". It holds no account permission and not "Release to production, exclude devices, and use Play App Signing".
- No Google key exists, so nothing rotates. Revoking the binding or the Play Console user stops the upload.

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
- The job `release-android` is bound to the same environment and reads four more secrets:
  - `ANDROID_UPLOAD_KEYSTORE_BASE64`, the upload keystore's bytes in base64;
  - `ANDROID_UPLOAD_KEYSTORE_PASSWORD`;
  - `ANDROID_UPLOAD_KEY_ALIAS`;
  - `ANDROID_UPLOAD_KEY_PASSWORD`.
- It also reads three of the environment's variables, which are not secret:
  - `GCP_PROJECT_NUMBER`, `knowno-515411`'s number;
  - `GCP_WORKLOAD_IDENTITY_POOL`, `knowno-github-release`;
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`, `knowno-github-release`.
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

### Android dry run

- The same pull requests, and those changing `scripts/release-android.ts`, `app/android/settings.gradle.kts` or `app/android/app/build.gradle.kts`, run the job `dry-run-android`. The iOS dry run runs on them too.
- The job runs in no environment and reads no secret:
  - `make release-android` with no tag first runs `flutter build appbundle` with no key, which must fail with the Gradle refusal;
  - it then makes a PKCS12 key valid for one day with `keytool -genkeypair`, builds 0.0.0 signed with it, and checks the signer as a release does;
  - `make release-android-upload` with no tag runs `./gradlew --dry-run :app:publishReleaseBundle`, which builds the upload's task graph with no key and runs none of it, so a graph that signs fails.
- It uploads nothing and reaches no Google account, so Play's acceptance and the federation are tested only by a release. It is not a required check.
- Dependabot's `gradle` entry for `/app/android` moves gradle-play-publisher alone, and runs this dry run.

### Cutting a release

1. Land the release's changes on `main` through pull requests.
2. Tag a commit of `main` and push the tag: `git tag v1.0.1 <commit>` and `git push origin v1.0.1`. Or run the `release` workflow by hand from that tag.
3. Watch the run. A refused tag uploads nothing. Delete it, fix what the refusal names, and tag again.
4. A rerun of a failed job keeps its run number. A version whose upload succeeded needs a new run, since App Store Connect refuses a build number twice and Play refuses a version code twice. Rerun only the failed job: a rerun of all jobs uploads the platform that succeeded again, and that store refuses it.

### In App Store Connect afterwards

- The build appears under TestFlight once processed, and Apple emails when it does. Internal testers can install it.
- External testers need it added to their group, and the first build of a version goes through beta review.
- Export compliance is answered by `ITSAppUsesNonExemptEncryption` `false` in `app/ios/Runner/Info.plist`.
- Submitting for App Review stays the owner's: create the version, choose the build, write its notes, and submit.

### In Play Console afterwards

- The build appears under Testing, Internal testing, as a completed release that internal testers can install.
- Promotion to closed or open testing, or to production, stays the owner's, by hand in Play Console. The service account cannot release to production.

### The owner's steps for Android

They are done once, before the first tag that should reach Play. Until then a tag's `release-android` fails and its iOS job is unaffected. Run the `gcloud` commands as an owner of `knowno-515411`.

1. **Create the upload key**, as Flutter's "Build and release an Android app" shows. Keep the keystore and its passwords outside the repository:

   ```sh
   keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA \
     -storetype JKS -keysize 2048 -validity 10000 -alias upload
   ```

2. **Create the app in Play Console** (Garam Apps) as `app.knowno`, if it does not exist yet.
3. **Upload the first bundle by hand and enrol in Play App Signing.** gradle-play-publisher's README requires this, since the API cannot register an app.
   1. Build the bundle signed with the upload key. The `read` prompts keep the passwords out of the shell's history:

      ```sh
      read -rs ANDROID_UPLOAD_KEYSTORE_PASSWORD; read -rs ANDROID_UPLOAD_KEY_PASSWORD
      export ANDROID_UPLOAD_KEYSTORE_PASSWORD ANDROID_UPLOAD_KEY_PASSWORD
      export ANDROID_UPLOAD_KEYSTORE=~/upload-keystore.jks ANDROID_UPLOAD_KEY_ALIAS=upload
      cd app && flutter build appbundle --release --dart-define-from-file=config/dev.json \
        --build-name=1.0.0 --build-number=1
      ```

   2. In Play Console, under Testing, Internal testing, create a release.
   3. Accept Play App Signing with a key Google generates.
   4. Upload the `.aab` from `app/build/app/outputs/bundle/release/`, and roll it out to internal testers.
   - Version code 1 stays below every tag's, which is the run number plus 1.
4. **Enable the APIs** the federation and the upload use, where they are not enabled already:

   ```sh
   gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
     sts.googleapis.com androidpublisher.googleapis.com --project=knowno-515411
   ```

5. **Create the workload identity pool and its OIDC provider:**

   ```sh
   gcloud iam workload-identity-pools create knowno-github-release \
     --project=knowno-515411 --location=global \
     --display-name="knowno GitHub release workflow"

   gcloud iam workload-identity-pools providers create-oidc knowno-github-release \
     --project=knowno-515411 --location=global \
     --workload-identity-pool=knowno-github-release \
     --display-name="knowno GitHub release workflow" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
     --attribute-condition="assertion.repository == 'garamsh/knowno' && assertion.ref.matches('^refs/tags/v[0-9]+[.][0-9]+[.][0-9]+$')"
   ```

6. **Let the repository's release tags impersonate the service account:**

   ```sh
   PROJECT_NUMBER=$(gcloud projects describe knowno-515411 --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding \
     github-actions-release@knowno-515411.iam.gserviceaccount.com \
     --project=knowno-515411 --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/knowno-github-release/attribute.repository/garamsh/knowno"
   ```

7. **Grant the service account Play Console access.**
   1. In Play Console (Garam Apps), go to Users and permissions, then Invite new users.
   2. Enter `github-actions-release@knowno-515411.iam.gserviceaccount.com`.
   3. Grant no account permission. Under App permissions, add `app.knowno` with "Release apps to testing tracks" alone.
8. **Set the four secrets and the three variables in the environment `release`:**

   ```sh
   base64 < ~/upload-keystore.jks | gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env release --repo garamsh/knowno
   gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD --env release --repo garamsh/knowno
   gh secret set ANDROID_UPLOAD_KEY_ALIAS --env release --repo garamsh/knowno --body upload
   gh secret set ANDROID_UPLOAD_KEY_PASSWORD --env release --repo garamsh/knowno
   gh variable set GCP_PROJECT_NUMBER --env release --repo garamsh/knowno --body "$PROJECT_NUMBER"
   gh variable set GCP_WORKLOAD_IDENTITY_POOL --env release --repo garamsh/knowno --body knowno-github-release
   gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env release --repo garamsh/knowno --body knowno-github-release
   ```

   - `gh secret set` with no `--body` prompts for the value.
   - The program strips the line breaks `base64` wraps with.

After these, the PM's next tag is the first upload through the API.

## Rationale

- [ADR 0192](adr/0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md) records:
  - the documentation read, and why signing follows Flutter's Codemagic CLI tools section rather than cloud signing, fastlane match or Xcode Cloud;
  - why the keys live in an environment only `v*` tags reach, and why the dry run builds unsigned;
  - why a tag must come from a pull request that passed CI on the same tree;
  - why the build number is the run number plus 1, and why App Review stays manual.

- [ADR 0266](adr/0266-sign-the-android-bundle-with-the-upload-key-and-upload-it-to-google-play-s-internal-track-from-the-version-tag-through-gradle-play-publisher-and-workload-identity-federation.md) records:
  - the documentation and source read, and why the upload goes through gradle-play-publisher rather than Codemagic CLI tools' `google-play`, which refuses all but a service account key;
  - why CI authenticates through Workload Identity Federation with no Google key, and how the pool admits only this repository's release tags;
  - why a release build without the upload key fails rather than signing with the debug key;
  - why both platforms release from one run, and why only the internal track is reached.

## Open questions

- None.
