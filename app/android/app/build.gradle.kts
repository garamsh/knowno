plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.github.triplet.play")
}

// The upload key a release build signs with, from the environment: only the release workflow holds
// it (docs/architecture/release.md). The keystore is a path.
val uploadKey =
    listOf(
        "ANDROID_UPLOAD_KEYSTORE",
        "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
        "ANDROID_UPLOAD_KEY_ALIAS",
        "ANDROID_UPLOAD_KEY_PASSWORD",
    ).associateWith { providers.environmentVariable(it).orNull.orEmpty() }

android {
    namespace = "app.knowno"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "app.knowno"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("upload") {
            storeFile = uploadKey.getValue("ANDROID_UPLOAD_KEYSTORE").takeIf { it.isNotEmpty() }?.let(::file)
            storePassword = uploadKey.getValue("ANDROID_UPLOAD_KEYSTORE_PASSWORD")
            keyAlias = uploadKey.getValue("ANDROID_UPLOAD_KEY_ALIAS")
            keyPassword = uploadKey.getValue("ANDROID_UPLOAD_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("upload")
        }
    }
}

// A build that signs the release with any part of the upload key unset fails before any task runs,
// so it never signs with another key. A debug build, and the upload of a built bundle, sign nothing.
gradle.taskGraph.whenReady {
    val signs = listOf(":app:validateSigningRelease", ":app:signReleaseBundle", ":app:packageRelease").any { hasTask(it) }
    val missing = uploadKey.filterValues { it.isEmpty() }.keys
    if (signs && missing.isNotEmpty()) {
        throw GradleException(
            "The release build signs only with the upload key, and ${missing.joinToString()} " +
                "is not set. The release workflow sets it (docs/architecture/release.md).",
        )
    }
}

// Uploads the bundle flutter build appbundle wrote to the internal track, as the service account the
// workflow's credentials file impersonates. Nothing here promotes a release to another track.
play {
    track.set("internal")
    defaultToAppBundles.set(true)
    useApplicationDefaultCredentials.set(true)
    artifactDir.set(layout.buildDirectory.dir("outputs/bundle/release"))
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
