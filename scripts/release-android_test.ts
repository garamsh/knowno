// scripts/release-android.ts against stubs of flutter and keytool.
import assert from "node:assert/strict";
import { BUNDLE, decoded, fingerprints } from "./release-android.ts";
import { host, program, RECORD, repository } from "./testing.ts";

const fp = (byte: string) => Array(32).fill(byte).join(":");
const UPLOAD = fp("AB");
const OTHER = fp("CD");

/** The upload key's secrets, the keystore holding `keystore` once decoded. */
const SECRETS = {
  ANDROID_UPLOAD_KEYSTORE_BASE64: btoa("keystore").replace(/(.{4})/, "$1\n"),
  ANDROID_UPLOAD_KEYSTORE_PASSWORD: "store-pass",
  ANDROID_UPLOAD_KEY_ALIAS: "upload",
  ANDROID_UPLOAD_KEY_PASSWORD: "key-pass",
};

/** The Gradle build's refusal of a release with no upload key, as build.gradle.kts words it. */
const REFUSAL =
  "The release build signs only with the upload key, and ANDROID_UPLOAD_KEYSTORE is not set.";

Deno.test("fingerprints reads every SHA-256 fingerprint keytool prints, and nothing else", () => {
  assert.deepEqual(
    fingerprints(
      `Certificate fingerprints:\n\t SHA1: ${
        fp("01").slice(0, 59)
      }\n\t SHA256: ${UPLOAD}\nSigner #2:\n\t SHA256: ${OTHER}\n`,
    ),
    [UPLOAD, OTHER],
  );
  assert.deepEqual(fingerprints("SHA256: AB:CD\n"), []);
});

Deno.test("decoded takes base64 wrapped over lines", () => {
  assert.equal(
    new TextDecoder().decode(decoded("a2V5\nc3Rv\r\ncmU=\n")),
    "keystore",
  );
});

/**
 * Stubs of the build's tools. flutter refuses as Gradle does where ANDROID_UPLOAD_KEYSTORE is unset,
 * and otherwise writes the bundle, logging the keystore it was given; keytool prints `key` for the
 * keystore and `signer` for the bundle.
 */
function tools(
  { key = UPLOAD, signer = UPLOAD, refuse = true, exit = 0 } = {},
) {
  return {
    flutter: `${RECORD}
echo "env: keystore \${ANDROID_UPLOAD_KEYSTORE:-unset}, base64 \${ANDROID_UPLOAD_KEYSTORE_BASE64:-unset}, alias \${ANDROID_UPLOAD_KEY_ALIAS:-unset}" >>"$(dirname "$0")/calls"
if [ -z "\${ANDROID_UPLOAD_KEYSTORE:-}" ]; then
  ${refuse ? `echo "${REFUSAL}" >&2; exit 1` : "exit 0"}
fi
echo "keystore $(/bin/ls -l "$ANDROID_UPLOAD_KEYSTORE" | sed -E 's/^(.{10}).*/\\1/'), holds $(cat "$ANDROID_UPLOAD_KEYSTORE")" >>"$(dirname "$0")/calls"
[ ${exit} = 0 ] || exit ${exit}
/bin/mkdir -p build/app/outputs/bundle/release && echo aab >build/app/outputs/bundle/release/app-release.aab`,
    keytool: `${RECORD}
case "$1" in
  -genkeypair) echo generated >"$3" ;;
  -list) printf 'Alias name: upload\\nCertificate fingerprints:\\n\\t SHA256: ${key}\\n' ;;
  -printcert) [ -f "$3" ] && printf 'Signer #1:\\n\\t SHA256: ${signer}\\n' ;;
esac`,
  };
}

async function appRepo(): Promise<{ repo: string; tmp: string }> {
  const repo = await repository();
  await Deno.mkdir(`${repo}/app`);
  return { repo, tmp: await Deno.realPath(await Deno.makeTempDir()) };
}

const built = (
  repo: string,
  path: string,
  tmp: string,
  tag?: string,
  env: Record<string, string> = SECRETS,
) =>
  program(
    repo,
    "release-android",
    [
      "build",
      "7",
      "--dart-define-from-file=config/dev.json",
      ...(tag ? [tag] : []),
    ],
    { PATH: path, TMPDIR: tmp, ...env },
  );

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

const BUILD =
  "flutter build appbundle --release --dart-define-from-file=config/dev.json";

Deno.test("build signs a tag with the decoded keystore, owner-only and out of the environment, checks the signer and removes the keystore", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(tools());
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 0, ran.stderr);
  const keystore = `${tmp}/release-android/upload.jks`;
  assert.equal(
    await log(),
    [
      `${BUILD} --build-name=1.2.3 --build-number=8`,
      `env: keystore ${keystore}, base64 unset, alias upload`,
      "keystore -rw-------, holds keystore",
      `keytool -list -v -keystore ${keystore} -alias upload -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
      `keytool -printcert -jarfile ${BUNDLE}`,
      "",
    ].join("\n"),
  );
  assert.equal(await exists(keystore), false);
  assert.equal(
    ran.stdout,
    `built ${BUNDLE}: 1.2.3 (8), signed by the upload key ${UPLOAD}\n`,
  );
});

Deno.test("build fails on a bundle another key signed, and passes one the upload key signed", async () => {
  const { repo, tmp } = await appRepo();
  const other = await host(tools({ signer: OTHER }));
  const refused = await built(repo, other.path, tmp, "v1.2.3");
  assert.equal(refused.code, 1);
  assert.equal(
    refused.stderr,
    `${BUNDLE} is signed by ${OTHER}, not the upload key ${UPLOAD}\n`,
  );
  assert.equal(await exists(`${tmp}/release-android/upload.jks`), false);

  const same = await host(tools());
  const control = await built(repo, same.path, tmp, "v1.2.3");
  assert.equal(control.code, 0, control.stderr);
});

Deno.test("build refuses a tag with a part of the upload key unset before building, and builds with every part", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(tools());
  for (const name of Object.keys(SECRETS)) {
    const refused = await built(repo, path, tmp, "v1.2.3", {
      ...SECRETS,
      [name]: "",
    });
    assert.equal(refused.code, 1, name);
    assert.equal(refused.stderr, `${name} is not set\n`);
  }
  assert.equal(await log(), "");

  const control = await built(repo, path, tmp, "v1.2.3");
  assert.equal(control.code, 0, control.stderr);
});

Deno.test("build removes the keystore when the build fails, and keeps the build's exit code", async () => {
  const { repo, tmp } = await appRepo();
  const { path } = await host(tools({ exit: 3 }));
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 3);
  assert.equal(await exists(`${tmp}/release-android/upload.jks`), false);
});

Deno.test("build with no tag shows a build with no key failing, then signs 0.0.0 with a key made for the run and removes it", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(tools());
  const ran = await built(repo, path, tmp, undefined, SECRETS);
  assert.equal(ran.code, 0, ran.stderr);
  const keystore = `${tmp}/release-android/upload.jks`;
  assert.equal(
    await log(),
    [
      `${BUILD} --build-name=0.0.0 --build-number=8`,
      "env: keystore unset, base64 unset, alias unset",
      `keytool -genkeypair -keystore ${keystore} -storetype PKCS12 -alias dry-run -keyalg RSA -keysize 2048 -validity 1 -dname CN=knowno release dry run -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD -keypass:env ANDROID_UPLOAD_KEY_PASSWORD`,
      `${BUILD} --build-name=0.0.0 --build-number=8`,
      `env: keystore ${keystore}, base64 unset, alias dry-run`,
      "keystore -rw-------, holds generated",
      `keytool -list -v -keystore ${keystore} -alias dry-run -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
      `keytool -printcert -jarfile ${BUNDLE}`,
      "",
    ].join("\n"),
  );
  assert.equal(await exists(keystore), false);
  assert.match(
    ran.stdout,
    /^a release build with no upload key failed: The release build signs only with the upload key\nbuilt .*: 0\.0\.0 \(8\), signed by the key made for this dry run AB:.*nothing is uploaded\n$/,
  );
});

Deno.test("build with no tag fails where a build with no key succeeds, and passes where it is refused", async () => {
  const { repo, tmp } = await appRepo();
  const signs = await host(tools({ refuse: false }));
  const ran = await built(repo, signs.path, tmp, undefined, {});
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /a release build with no upload key succeeded; it must fail with "The release build signs only with the upload key"\n$/,
  );

  const refuses = await host(tools());
  const control = await built(repo, refuses.path, tmp, undefined, {});
  assert.equal(control.code, 0, control.stderr);
});
