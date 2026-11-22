// The release workflow's build step for the Android app (docs/architecture/release.md, ADR 0266):
//   build <run> <config> [tag]  builds the App Bundle as the tag's version, signed with the upload key
//                               from ANDROID_UPLOAD_KEYSTORE_BASE64 and its passwords and alias, and
//                               checks that the upload key signed it; with no tag, a dry run as 0.0.0
//                               that first shows a build with no key failing, then signs with a key
//                               made for the run
// The keystore is written under TMPDIR readable by its owner alone, dropped from the environment
// before any tool starts, and removed when the step ends. Gradle uploads the bundle
// (make release-android-upload).
import { attached, entry, fail, merged, read } from "./process.ts";
import { buildNumberOf, versionOf } from "./release-ios.ts";

/** The variables app/android/app/build.gradle.kts signs the release with. */
export const UPLOAD_KEY = [
  "ANDROID_UPLOAD_KEYSTORE",
  "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
  "ANDROID_UPLOAD_KEY_ALIAS",
  "ANDROID_UPLOAD_KEY_PASSWORD",
] as const;

/** The secret that holds the keystore, base64-encoded, in place of the keystore's path. */
const KEYSTORE_BASE64 = "ANDROID_UPLOAD_KEYSTORE_BASE64";

/** Where flutter build appbundle writes the bundle, relative to the repository. */
export const BUNDLE = "app/build/app/outputs/bundle/release/app-release.aab";

/** What the Gradle build says when it refuses to sign the release with no upload key. */
const REFUSAL = "The release build signs only with the upload key";

/** The SHA-256 certificate fingerprints keytool prints, as `SHA256: AB:CD:…`. */
export function fingerprints(keytool: string): string[] {
  return [...keytool.matchAll(/SHA256: ([0-9A-F]{2}(?::[0-9A-F]{2}){31})/g)]
    .map((m) => m[1]);
}

/** The bytes of a base64 value, ignoring the line breaks an encoder wraps it with. */
export function decoded(base64: string): Uint8Array {
  return Uint8Array.from(
    atob(base64.replace(/\s/g, "")),
    (c) => c.charCodeAt(0),
  );
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") fail(`${name} is not set`);
  return value;
}

const work = () => `${required("TMPDIR")}/release-android`;

/** Removes a path; one already gone is no error, and any other failure is. */
async function removeIfPresent(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/**
 * Runs the step with the keystore `make` writes, at a path under TMPDIR, then removes it. A removal
 * that fails is reported and fails the program, after the step's own error if any.
 */
async function withKeystore(
  make: (path: string) => Promise<void>,
  step: (path: string) => Promise<void>,
): Promise<void> {
  await Deno.mkdir(work(), { recursive: true, mode: 0o700 });
  const path = `${work()}/upload.jks`;
  let outcome: { error: unknown } | undefined;
  try {
    await removeIfPresent(path);
    await make(path);
    await step(path);
  } catch (error) {
    outcome = { error };
  }
  let unremoved: unknown;
  try {
    await removeIfPresent(path);
  } catch (error) {
    console.error(`could not remove ${path}: ${error}`);
    unremoved = error;
  }
  if (outcome !== undefined) throw outcome.error;
  if (unremoved !== undefined) throw unremoved;
}

function appbundle(config: string, version: string, number: number): string[] {
  return [
    "build",
    "appbundle",
    "--release",
    config,
    `--build-name=${version}`,
    `--build-number=${number}`,
  ];
}

/** Builds the bundle with the keystore at `keystore` and fails unless that keystore's key signed it. */
async function signedBuild(
  keystore: string,
  config: string,
  version: string,
  number: number,
): Promise<string> {
  await removeIfPresent(BUNDLE);
  await attached("flutter", appbundle(config, version, number), {
    cwd: "app",
    env: { ANDROID_UPLOAD_KEYSTORE: keystore },
  });
  const [key] = fingerprints(
    await read("keytool", [
      "-list",
      "-v",
      "-keystore",
      keystore,
      "-alias",
      required("ANDROID_UPLOAD_KEY_ALIAS"),
      "-storepass:env",
      "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
    ]),
  );
  if (key === undefined) {
    fail(`keytool printed no SHA-256 fingerprint for the upload key`);
  }
  const signers = fingerprints(
    await read("keytool", ["-printcert", "-jarfile", BUNDLE]),
  );
  if (signers.length !== 1 || signers[0] !== key) {
    fail(
      `${BUNDLE} is signed by ${
        signers.join(", ") || "no certificate"
      }, not the upload key ${key}`,
    );
  }
  return key;
}

async function build(run: string, config: string, tag?: string): Promise<void> {
  const number = buildNumberOf(run);
  if (number === undefined) {
    fail(`the run number "${run}" is not a positive integer`);
  }
  if (tag === undefined) return await dryRun(config, number);
  const version = versionOf(tag);
  if (version === undefined) {
    fail(`the tag "${tag}" is not v<major>.<minor>.<patch>`);
  }
  for (const name of UPLOAD_KEY.slice(1)) required(name);
  const bytes = decoded(required(KEYSTORE_BASE64));
  Deno.env.delete(KEYSTORE_BASE64);
  let key = "";
  await withKeystore(
    (path) => Deno.writeFile(path, bytes, { mode: 0o600, createNew: true }),
    async (keystore) => {
      key = await signedBuild(keystore, config, version, number);
    },
  );
  console.log(
    `built ${BUNDLE}: ${version} (${number}), signed by the upload key ${key}`,
  );
}

/**
 * A pull request's dry run: shows that a release build with no upload key fails, then builds the
 * bundle as 0.0.0 signed with a key made for this run alone.
 */
async function dryRun(config: string, number: number): Promise<void> {
  const version = "0.0.0";
  for (const name of [...UPLOAD_KEY, KEYSTORE_BASE64]) Deno.env.delete(name);
  const unsigned = await merged("flutter", appbundle(config, version, number), {
    cwd: "app",
  });
  if (unsigned.code === 0 || !unsigned.output.includes(REFUSAL)) {
    console.error(unsigned.output);
    fail(
      `a release build with no upload key ${
        unsigned.code === 0 ? "succeeded" : "failed for another reason"
      }; it must fail with "${REFUSAL}"`,
    );
  }
  console.log(`a release build with no upload key failed: ${REFUSAL}`);

  const password = crypto.randomUUID();
  Deno.env.set("ANDROID_UPLOAD_KEYSTORE_PASSWORD", password);
  Deno.env.set("ANDROID_UPLOAD_KEY_PASSWORD", password);
  Deno.env.set("ANDROID_UPLOAD_KEY_ALIAS", "dry-run");
  let key = "";
  await withKeystore(
    (path) =>
      attached("keytool", [
        "-genkeypair",
        "-keystore",
        path,
        "-storetype",
        "PKCS12",
        "-alias",
        "dry-run",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "1",
        "-dname",
        "CN=knowno release dry run",
        "-storepass:env",
        "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
        "-keypass:env",
        "ANDROID_UPLOAD_KEY_PASSWORD",
      ]).then(() => Deno.chmod(path, 0o600)),
    async (keystore) => {
      key = await signedBuild(keystore, config, version, number);
    },
  );
  console.log(
    `built ${BUNDLE}: ${version} (${number}), signed by the key made for this dry run ${key}; no tag was given, so it holds no upload key and nothing is uploaded`,
  );
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "build" && (rest.length === 2 || rest.length === 3)) {
    return await build(rest[0], rest[1], rest[2] || undefined);
  }
  fail("usage: release-android build <run> <config> [tag]", 2);
}

if (import.meta.main) await entry(main);
