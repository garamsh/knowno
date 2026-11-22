# ADR 0266: Sign the Android bundle with the upload key and upload it to Google Play's internal track from the version tag, through gradle-play-publisher and Workload Identity Federation

> Status: accepted
> Date: 2026-11-22

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #1003**, part of goal #1000. The release build type signed with the debug key (`app/android/app/build.gradle.kts` on `main` at `764464e9`), and no workflow built or uploaded an Android App Bundle. The iOS app goes out from a version tag ([ADR 0192](0192-build-and-upload-the-ios-app-to-testflight-from-a-version-tag-signed-through-codemagic-cli-tools.md)).
- **The issue's comments settle the scope:**
  - comment 7062002593: the same tag and structure as the iOS release, the internal testing track only, promotion manual, and tools rather than shell. Prefer Codemagic CLI tools' Google Play command, since ADR 0192 uses those tools; otherwise gradle-play-publisher.
  - comment 7062191404: no JSON key. CI authenticates through GitHub OIDC with `google-github-actions/auth`, impersonating `github-actions-release@knowno-515411.iam.gserviceaccount.com`. The pool and provider admit only `garamsh/knowno` on a release tag, and are named for their consumer, as aurora's ADR 0029 ("A credential's name at its issuer is its cluster and its consumer") names credentials. The upload tool must accept the credentials file the action writes.
  - #1000 comment 7062122855: tag builds may go to TestFlight and Play's internal track. Production and review submission stay the owner's.
- **What the sources say** (each read 2026-11-22):
  - **Codemagic CLI tools 0.71.0**, the latest on PyPI (tag `v0.71.0`, commit `5988938b06563b5a65bfa47acfe5b2623106b431`).
    - `docs/google-play/bundles/publish.md` documents `google-play bundles publish --bundle … --track …`.
    - `src/codemagic/tools/google_play/argument_types.py` accepts `--credentials` only as JSON whose `type` is `service_account`. Any other value is refused with "Provided value is not a service account object".
    - `src/codemagic/google/google_client.py` builds the credentials with oauth2client's `ServiceAccountCredentials.from_json_keyfile_dict`.
    - So it cannot take the `external_account` file Workload Identity Federation writes.
  - **gradle-play-publisher 4.1.2**, the latest release (2026-11-12, tag `4.1.2`, commit `d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6`; the Gradle Plugin Portal's latest is the same).
    - The README's "Application Default Credentials" section configures `useApplicationDefaultCredentials = true` instead of a JSON key.
    - In `play/android-publisher/src/main/kotlin/com/github/triplet/gradle/androidpublisher/internal/AndroidPublisher.kt`, that path calls `GoogleCredentials.getApplicationDefault()`.
    - The README's "Common configuration" names `internal` as `track`'s default. Its "Uploading a pre-existing artifact" section takes `artifactDir`, which uploads the bundles in a directory without building them.
    - Its "Initial Play Store upload" says the first bundle must be uploaded through Play Console, since the API cannot register the app.
    - Release 4.0.0's notes say it supports Android Gradle Plugin 9, which `app/android/settings.gradle.kts` applies (9.1.0).
    - `PlayApiService.kt` builds the credentials only when a task calls the API, so a build that publishes nothing needs none.
  - **google-auth-library-java 1.20.0**, the version the plugin's `android-publisher-4.1.2.pom` depends on (tag `v1.20.0`).
    - `GoogleCredentials.java` reads a file whose `type` is `external_account` as `ExternalAccountCredentials`.
    - `IdentityPoolCredentialSource.java` reads a subject token from a `url` with `headers` and a `json` format.
    - The README says Application Default Credentials "also support workload identity federation". The first place they are looked for is the file `GOOGLE_APPLICATION_CREDENTIALS` names.
  - **google-github-actions/auth v3.0.0** (commit `7c6bc770dae815cd3e89ee6cdf493a5fab2cc093`), the latest release. The tag `v3` points at the same commit.
    - Its README's "Workload Identity Federation through a Service Account" takes `workload_identity_provider` and `service_account`, and requires `id-token: write` and the checkout before the action.
    - `create_credentials_file` defaults to true, and the action exports `GOOGLE_APPLICATION_CREDENTIALS`.
    - `src/client/workload_identity_federation.ts` writes that file as `type: external_account`. Its `credential_source` is the job's OIDC token URL, with its bearer header and the `json` format, and it carries a `service_account_impersonation_url`. That is the shape the auth library reads.
    - The same README gives the `gcloud` commands for the pool, the OIDC provider and the `roles/iam.workloadIdentityUser` binding.
  - **Flutter's "Build and release an Android app"** (`flutter/website` commit `47e8fa5df802743e362c30e2653c5eac1b28f57a`, `sites/docs/src/content/deployment/android.md`).
    - An `.aab` is uploaded signed with an upload key, and Play App Signing signs what users download.
    - It creates the upload keystore with `keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA -storetype JKS -keysize 2048 -validity 10000 -alias upload`.
    - It configures Gradle's release `signingConfig` from the key, there through a `key.properties` file, and builds with `flutter build appbundle`.
  - **Play Console Help, ["Add developer account users and manage permissions"](https://support.google.com/googleplay/android-developer/answer/9844686).**
    - The app permission "Release apps to testing tracks" is to "Create, edit, and roll out releases to testing tracks", and "Does not allow users to publish apps to production on Google Play".
    - Production is the separate permission "Release to production, exclude devices, and use Play App Signing".
  - **The Play Developer API's ["Getting started"](https://developers.google.com/android-publisher/getting_started).** It enables the API for the Google Cloud project. It adds the service account through Users and permissions, Invite new users, with the account's email address.
  - **Advisories.** The GitHub Advisory Database lists none for `google-github-actions/auth` (actions) or `com.github.triplet.gradle:play-publisher` (Maven). OSV lists none for play-publisher 4.1.2, google-auth-library-oauth2-http 1.20.0 or the action at 3.0.0.
- **Alternatives considered:**
  - **Codemagic CLI tools' `google-play bundles publish`**, which the issue preferred to match ADR 0192. Rejected: it refuses any credential but a service account key.
  - **fastlane `supply`.** The issue names it only for a fastlane iOS release, and ADR 0192's is not. Not taken.
  - **A JSON service account key** in the `release` environment, which every tool above accepts. Rejected by comment 7062191404: no long-lived Google secret is stored.
  - **A hand-written upload** through the Play Developer API with `curl` or a script. Excluded by the issue.
  - **`key.properties`**, as Flutter's page shows. Rejected: it writes the passwords to a file beside the keystore, and the step already has them in its environment. Gradle reads the same four values from the environment.
  - **Falling back to the debug key** when the upload key is absent, as the template did so that `flutter run --release` works. Rejected by the issue: a release build without the key fails.
  - **A workflow of its own.** Rejected: the same tag would then start two runs with two run numbers, and the platforms' builds would get different numbers.

## Decision

- **The release build type signs with the upload key alone.**
  - `app/android/app/build.gradle.kts` reads `ANDROID_UPLOAD_KEYSTORE` (a path), `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` and `ANDROID_UPLOAD_KEY_PASSWORD` from the environment into the signing config `upload`.
  - A build whose task graph signs the release (`validateSigningRelease`, `signReleaseBundle` or `packageRelease`) fails before any task runs while any of the four is unset, naming them.
  - A debug build signs with the debug key as before, and the upload signs nothing, so neither needs the key.
- **The same tag releases both platforms, in one run of `.github/workflows/release.yml`.** The job `release-android` runs on `ubuntu-24.04` in the environment `release`, beside the job `release`, which this decision does not change. It runs, in order:
  1. `make release-check`, ADR 0192's gate;
  2. `make release-android`, which runs `scripts/release-android.ts`;
  3. `google-github-actions/auth`;
  4. `make release-android-upload`.
- **`make release-android` builds and checks the bundle.**
  - It decodes `ANDROID_UPLOAD_KEYSTORE_BASE64` to a file under the runner's temporary directory, mode 600, and drops the secret from the environment before any tool starts.
  - It runs `flutter build appbundle --release --dart-define-from-file=config/dev.json --build-name=<tag's version> --build-number=<run + 1>`, the version code being the iOS build number.
  - It fails unless `keytool -printcert -jarfile` names exactly one signer, whose SHA-256 fingerprint is the upload key's.
  - It removes the keystore when the step ends. A removal that fails fails the step.
- **`make release-android-upload` runs gradle-play-publisher's `:app:publishReleaseBundle`.**
  - The plugin is 4.1.2, applied in `app/android/app/build.gradle.kts` with `track` `internal`, `defaultToAppBundles`, `useApplicationDefaultCredentials` and `artifactDir` set to the directory `flutter build appbundle` writes.
  - It uploads that bundle and commits a completed release to the internal track. Nothing in the repository promotes a release or names another track.
- **Authentication is Workload Identity Federation through the service account.**
  - The job alone has `id-token: write`, beside the read permissions `make release-check` needs.
  - `google-github-actions/auth` v3.0.0, pinned by commit, takes `workload_identity_provider` from the environment's variables `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL` and `GCP_WORKLOAD_IDENTITY_PROVIDER`, and `service_account` `github-actions-release@knowno-515411.iam.gserviceaccount.com`.
  - The pool and the provider are both `knowno-github-release`, the form `<system>-<consumer>`, and live in `knowno-515411`.
  - The provider maps `google.subject`, `attribute.repository` and `attribute.ref` from the token. Its condition admits `assertion.repository == 'garamsh/knowno'` with `assertion.ref` matching `^refs/tags/v[0-9]+[.][0-9]+[.][0-9]+$`, the tags the workflow's `push` trigger takes.
  - The service account's `roles/iam.workloadIdentityUser` is bound to the pool's principal set for `attribute.repository/garamsh/knowno`. No Google key exists.
- **Play Console grants the service account one app permission on `app.knowno`, "Release apps to testing tracks"**, and no account permission, so it cannot release to production.
- **The first bundle is uploaded by hand**, signed with the upload key, which enrols the app in Play App Signing, as the plugin's README requires.
- **A pull request that changes what the Android release runs gets the job `dry-run-android`.** That is the paths ADR 0192 lists, plus `scripts/release-android.ts` and the two Gradle build files.
  - It runs in no environment and reads no secret.
  - `make release-android` with no tag first shows that `flutter build appbundle` with no key fails with the Gradle refusal. It then makes a PKCS12 key with `keytool -genkeypair`, valid one day, and builds 0.0.0 signed with it, checking the signer as a release does.
  - `make release-android-upload` with no tag runs `./gradlew --dry-run :app:publishReleaseBundle`. That builds the upload's task graph with no key and runs none of it, so a graph that would sign fails the refusal.
- **Dependabot's `gradle` entry for `/app/android`, allowing `com.github.triplet.play*` alone, moves the plugin.** Dependabot's `github-actions` entry moves the action.

## Consequences

- One tag push sends a build to TestFlight and to Play's internal track, with the same version and build number, and either can fail alone.
- No branch or pull request reaches the upload key, and the provider admits no token but a release tag's of this repository, so an upload is tested only by a release. The dry run tests the build, the refusal, the signer check and the upload's task graph, but not Play's acceptance or the federation.
- The first release after the owner's steps is the first test of the federation and of Play's permission. A refusal there points at a step, not at the workflow, once the dry run passes.
- `flutter run --release` and `flutter build apk --release` on a contributor's machine now fail without the upload key in the environment. A contributor exports the four variables, or runs a profile or debug build.
- Play refuses a version code twice, so a version whose upload succeeded needs a new run, as on iOS.
- The upload key's loss is recoverable: Play App Signing holds the app signing key, and the owner asks Play Console to reset the upload key.
- The plugin version is pinned by version alone, as the Android Gradle and Kotlin plugins beside it are. The repository records no checksum of Gradle artifacts.

## Signs the decision was wrong

- The federated credentials fail in the plugin where a JSON key would succeed, so the auth library's external-account support does not hold for this API.
- A release reaches a track other than internal, or is promoted, without the owner acting in Play Console.
- A release build signs with a key other than the upload key, though the signer check passed.
- A Gradle change makes the refusal stop firing, and the dry run passes a build with no key. The task names the check looks for would then have moved.
