// scripts/release-ios.ts against stubs of gh, keychain, app-store-connect, xcode-project, flutter, unzip, plutil and codesign.
import assert from "node:assert/strict";
import {
  buildNumberOf,
  entitlementKeys,
  pullRequestOf,
  unpassed,
  versionOf,
} from "./release-ios.ts";
import {
  commit,
  git,
  host,
  program,
  RECORD,
  repository,
  write,
} from "./testing.ts";

const ENTITLEMENTS = "app/ios/Runner/Runner.entitlements";
const GRANTED =
  `<plist><dict><key>com.apple.developer.applesignin</key><array><string>Default</string></array></dict></plist>\n`;
const KEY = {
  APP_STORE_CONNECT_KEY_P8:
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n",
  APP_STORE_CONNECT_KEY_ID: "KEY123",
  APP_STORE_CONNECT_ISSUER_ID: "issuer-1",
};
const success = (name: string) => ({
  name,
  status: "completed",
  conclusion: "success",
});

Deno.test("versionOf takes only v<major>.<minor>.<patch>", () => {
  assert.equal(versionOf("v1.0.1"), "1.0.1");
  assert.equal(versionOf("v10.0.20"), "10.0.20");
  for (
    const tag of [
      "1.0.1",
      "v1.0",
      "v1.0.1-rc1",
      "v01.0.1",
      "v1.0.1.2",
      "x/v1.0.1",
      "",
    ]
  ) {
    assert.equal(versionOf(tag), undefined, tag);
  }
});

Deno.test("buildNumberOf adds the offset to a positive run number and takes nothing else", () => {
  assert.equal(buildNumberOf("1"), 2);
  assert.equal(buildNumberOf("41"), 42);
  for (const run of ["0", "-1", "1.5", "", "07"]) {
    assert.equal(buildNumberOf(run), undefined, run);
  }
});

Deno.test("pullRequestOf reads the number a squash merge ends its subject with", () => {
  assert.equal(pullRequestOf("fix: draw the label (#730)"), 730);
  assert.equal(pullRequestOf("fix: see #730 later"), undefined);
  assert.equal(pullRequestOf("fix: draw (#730) the label"), undefined);
});

Deno.test("unpassed names each required check that has no successful latest run", () => {
  assert.deepEqual(
    unpassed([success("ci (ubuntu)"), success("ci (macos)")]),
    [],
  );
  assert.deepEqual(
    unpassed([
      success("ci (ubuntu)"),
      { name: "ci (macos)", status: "completed", conclusion: "failure" },
    ]),
    ["ci (macos): failure"],
  );
  assert.deepEqual(
    unpassed([{
      name: "ci (ubuntu)",
      status: "in_progress",
      conclusion: null,
    }]),
    ["ci (ubuntu): in_progress", "ci (macos): no run"],
  );
});

Deno.test("entitlementKeys lists the keys of an entitlements plist", () => {
  assert.deepEqual(entitlementKeys(GRANTED), [
    "com.apple.developer.applesignin",
  ]);
});

/** A repository whose main holds one commit landed by pull request #7, origin/main at it. */
async function landed(subject = "feat: add the thing (#7)") {
  const repo = await repository();
  await write(repo, "README.md", "x\n");
  await commit(repo, subject);
  await git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  return {
    repo,
    sha: await git(repo, "rev-parse", "HEAD"),
    tree: await git(repo, "rev-parse", "HEAD^{tree}"),
  };
}

/** A gh that answers the pull request, its head's tree and its head's check runs. */
function gh(
  pull: { merge: string; head: string },
  tree: string,
  macos = "success",
): string {
  const run = (name: string, conclusion: string) =>
    JSON.stringify({ check_runs: [{ name, status: "completed", conclusion }] });
  return `${RECORD}
case "$2" in
  repos/o/r/pulls/7) echo '${
    JSON.stringify({ merge_commit_sha: pull.merge, head: { sha: pull.head } })
  }' ;;
  repos/o/r/git/commits/${pull.head}) echo '${
    JSON.stringify({ tree: { sha: tree } })
  }' ;;
  *check_name=ci%20\\(ubuntu\\)*) echo '${run("ci (ubuntu)", "success")}' ;;
  *check_name=ci%20\\(macos\\)*) echo '${run("ci (macos)", macos)}' ;;
  *) exit 1 ;;
esac`;
}

const checked = (repo: string, path: string, tag = "v1.2.3") =>
  program(repo, "release-ios", ["check", tag], {
    PATH: path,
    GITHUB_REPOSITORY: "o/r",
  });

const PASSED = /: releasing 1\.2\.3\n$/;

Deno.test("check passes a tag on main whose pull request passed CI on the same tree", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const { path } = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 0, ran.stderr);
  assert.match(
    ran.stdout,
    /landed by pull request #7, whose head abc holds the same tree .*: releasing 1\.2\.3\n$/,
  );
});

Deno.test("check refuses a tag not of the form before asking GitHub, and passes the form on the same commit", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  await git(repo, "tag", "v1.2.3-rc1");
  const { path, log } = await host({
    gh: gh({ merge: sha, head: "abc" }, tree),
  });
  const refused = await checked(repo, path, "v1.2.3-rc1");
  assert.equal(refused.code, 1);
  assert.equal(
    refused.stderr,
    `the tag "v1.2.3-rc1" is not v<major>.<minor>.<patch>; nothing is released\n`,
  );
  assert.equal(await log(), "");

  const control = await checked(repo, path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

Deno.test("check refuses a tag on a commit main does not hold, and passes one on main", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  await write(repo, "README.md", "y\n");
  await commit(repo, "feat: off main (#7)");
  await git(repo, "tag", "v1.2.4");
  const off = await git(repo, "rev-parse", "HEAD");
  assert.equal(await git(repo, "rev-parse", "refs/remotes/origin/main"), sha);
  const { path } = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const refused = await checked(repo, path, "v1.2.4");
  assert.equal(refused.code, 1);
  assert.equal(
    refused.stderr,
    `v1.2.4 is ${off}, which is not on main; nothing is released\n`,
  );

  const control = await checked(repo, path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

Deno.test("check refuses a commit whose subject names no pull request, and passes one that does", async () => {
  const bare = await landed("feat: pushed straight to main");
  await git(bare.repo, "tag", "v1.2.3");
  const named = await landed();
  await git(named.repo, "tag", "v1.2.3");
  assert.equal(bare.tree, named.tree);
  const { path } = await host({
    gh: gh({ merge: named.sha, head: "abc" }, named.tree),
  });
  const refused = await checked(bare.repo, path);
  assert.equal(refused.code, 1);
  assert.match(
    refused.stderr,
    /names no pull request at the end of its subject/,
  );

  const control = await checked(named.repo, path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

Deno.test("check refuses where the pull request merged as another commit, and passes where it merged as the tag's", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const other = await host({ gh: gh({ merge: "f00", head: "abc" }, tree) });
  const refused = await checked(repo, other.path);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^pull request #7 merged as f00, not /);

  const same = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const control = await checked(repo, same.path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

Deno.test("check refuses where the pull request's head holds another tree, and passes where it holds the tag's", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const other = await host({ gh: gh({ merge: sha, head: "abc" }, "0ther") });
  const refused = await checked(repo, other.path);
  assert.equal(refused.code, 1);
  assert.match(
    refused.stderr,
    /holds tree 0ther, .* so its CI run did not test what v1\.2\.3 builds\n$/,
  );

  const same = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const control = await checked(repo, same.path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

Deno.test("check refuses where a required check did not pass, and passes where both did", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const failing = await host({
    gh: gh({ merge: sha, head: "abc" }, tree, "failure"),
  });
  const refused = await checked(repo, failing.path);
  assert.equal(refused.code, 1);
  assert.equal(
    refused.stderr,
    "pull request #7's CI did not pass on abc; nothing is released:\nci (macos): failure\n",
  );

  const passing = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const control = await checked(repo, passing.path);
  assert.equal(control.code, 0, control.stderr);
  assert.match(control.stdout, PASSED);
});

/** Shell that logs a key file's mode and second line, as `<label> mode -rw-------, holds <line>`. */
const keyLine = (label: string, path: string) =>
  `echo "${label} mode $(/bin/ls -l "${path}" | sed -E 's/^(.{10}).*/\\1/'), holds $(sed -n 2p "${path}")" >>"$(dirname "$0")/calls"`;

/** Shell that logs whether either key's contents reached the tool's environment. */
const ENV_LINE =
  `echo "keys in env: \${APP_STORE_CONNECT_KEY_P8:-no} \${IOS_DISTRIBUTION_CERT_PRIVATE_KEY:-no}" >>"$(dirname "$0")/calls"`;

/** Stubs of the build's tools; the built app holds `version` (`number`) and `entitled`. */
function buildTools(version: string, number: string, entitled: string) {
  return {
    keychain: RECORD,
    "app-store-connect": `${RECORD}
prev=; for a in "$@"; do case $prev in --certificate-key) cert=\${a#@file:} ;; --private-key) api=\${a#@file:} ;; --certificates-dir) dir=$a ;; esac; prev=$a; done
${keyLine("api key", "$api")}
[ -z "$cert" ] || ${keyLine("certificate key", "$cert")}
${ENV_LINE}
[ -z "$dir" ] || { /bin/mkdir -p "$dir" && echo p12 >"$dir/distribution.p12"; }`,
    "xcode-project": RECORD,
    flutter: `${RECORD}
${ENV_LINE}
/bin/mkdir -p build/ios/ipa && echo ipa >build/ios/ipa/knowno.ipa`,
    unzip: `${RECORD}\n/bin/mkdir -p "$4/Payload/Runner.app"`,
    plutil:
      `case "$2" in CFBundleShortVersionString) echo ${version} ;; CFBundleVersion) echo ${number} ;; esac`,
    codesign:
      `${RECORD}\n[ "$1" = -d ] && echo '<key>application-identifier</key><key>${entitled}</key>'; exit 0`,
  };
}

const KEYS = {
  ...KEY,
  IOS_DISTRIBUTION_CERT_PRIVATE_KEY:
    "-----BEGIN RSA PRIVATE KEY-----\ncertsecret\n-----END RSA PRIVATE KEY-----\n",
};
const IPA = "app/build/ios/ipa/knowno.ipa";

async function appRepo(): Promise<{ repo: string; tmp: string }> {
  const repo = await repository();
  await write(repo, ENTITLEMENTS, GRANTED);
  await Deno.mkdir(`${repo}/app/ios`, { recursive: true });
  return { repo, tmp: await Deno.realPath(await Deno.makeTempDir()) };
}

const built = (repo: string, path: string, tmp: string, tag?: string) =>
  program(
    repo,
    "release-ios",
    [
      "build",
      "7",
      "--dart-define-from-file=config/dev.json",
      ...(tag ? [tag] : []),
    ],
    { PATH: path, TMPDIR: tmp, ...KEYS },
  );

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

const linesOf = (calls: string, prefix: string) =>
  calls.split("\n").filter((l) => l.startsWith(prefix));

Deno.test("build fetches the signing files with both keys, owner-only and out of the environment, and removes them after", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(
    buildTools("1.2.3", "8", "com.apple.developer.applesignin"),
  );
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 0, ran.stderr);
  const work = `${tmp}/release-ios`;
  const calls = await log();
  const api =
    `--issuer-id @env:APP_STORE_CONNECT_ISSUER_ID --key-id @env:APP_STORE_CONNECT_KEY_ID --private-key @file:${work}/api_key.p8 --disable-jwt-cache`;
  for (
    const call of [
      "keychain initialize",
      `app-store-connect fetch-signing-files app.knowno --platform IOS --type IOS_APP_STORE --certificate-key @file:${work}/certificate_key.pem --create --strict-match-identifier --certificates-dir ${work}/certificates ${api}`,
      `keychain add-certificates --certificate ${work}/certificates/*.p12`,
      `xcode-project use-profiles --project ios/Runner.xcodeproj --export-options-plist ${work}/export_options.plist`,
      `flutter build ipa --release --dart-define-from-file=config/dev.json --build-name=1.2.3 --build-number=8 --export-options-plist=${work}/export_options.plist`,
    ]
  ) {
    assert.ok(calls.includes(`${call}\n`), `${call}\nnot in\n${calls}`);
  }
  assert.deepEqual(linesOf(calls, "api key mode"), [
    "api key mode -rw-------, holds secret",
  ]);
  assert.deepEqual(linesOf(calls, "certificate key mode"), [
    "certificate key mode -rw-------, holds certsecret",
  ]);
  assert.deepEqual(linesOf(calls, "keys in env"), [
    "keys in env: no no",
    "keys in env: no no",
  ]);
  for (const left of ["api_key.p8", "certificate_key.pem", "certificates"]) {
    assert.equal(await exists(`${work}/${left}`), false, left);
  }
  assert.equal(
    ran.stdout,
    `exported ${IPA}: 1.2.3 (8), signed for App Store Connect with the 1 entitlement keys of ${ENTITLEMENTS}\n`,
  );
});

Deno.test("build with no tag is a dry run as 0.0.0", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(
    buildTools("0.0.0", "8", "com.apple.developer.applesignin"),
  );
  const ran = await built(repo, path, tmp);
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok((await log()).includes("--build-name=0.0.0 --build-number=8 "));
  assert.ok(
    ran.stdout.endsWith("no tag was given, so this was a dry run as 0.0.0\n"),
    ran.stdout,
  );
});

Deno.test("build fails on an ipa of another version, or signed without the app's entitlements, and passes one holding both", async () => {
  const { repo, tmp } = await appRepo();
  const whole = await host(
    buildTools("1.2.3", "8", "com.apple.developer.applesignin"),
  );
  const control = await built(repo, whole.path, tmp, "v1.2.3");
  assert.equal(control.code, 0, control.stderr);

  const other = await host(
    buildTools("1.2.3", "1", "com.apple.developer.applesignin"),
  );
  const stale = await built(repo, other.path, tmp, "v1.2.3");
  assert.equal(stale.code, 1);
  assert.equal(stale.stderr, `${IPA} holds 1.2.3 (1), not 1.2.3 (8)\n`);

  const bare = await host(buildTools("1.2.3", "8", "get-task-allow"));
  const unentitled = await built(repo, bare.path, tmp, "v1.2.3");
  assert.equal(unentitled.code, 1);
  assert.equal(
    unentitled.stderr,
    `${tmp}/release-ios/unpacked/Payload/Runner.app is signed without com.apple.developer.applesignin, which ${ENTITLEMENTS} grants\n`,
  );
});

Deno.test("build removes both keys when fetching the signing files fails", async () => {
  const { repo, tmp } = await appRepo();
  const { path } = await host({
    ...buildTools("1.2.3", "8", "x"),
    "app-store-connect": "exit 4",
  });
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 4);
  for (const key of ["api_key.p8", "certificate_key.pem"]) {
    assert.equal(await exists(`${tmp}/release-ios/${key}`), false, key);
  }
});

Deno.test("upload publishes the built ipa with the API key alone, removed after", async () => {
  const { repo, tmp } = await appRepo();
  await write(repo, IPA, "ipa");
  const { path, log } = await host(buildTools("1.2.3", "8", "x"));
  const ran = await program(repo, "release-ios", ["upload"], {
    PATH: path,
    TMPDIR: tmp,
    ...KEY,
  });
  assert.equal(ran.code, 0, ran.stderr);
  const key = `${tmp}/release-ios/api_key.p8`;
  assert.equal(
    await log(),
    `app-store-connect publish --path ${IPA} --issuer-id @env:APP_STORE_CONNECT_ISSUER_ID --key-id @env:APP_STORE_CONNECT_KEY_ID --private-key @file:${key} --disable-jwt-cache\napi key mode -rw-------, holds secret\nkeys in env: no no\n`,
  );
  assert.equal(await exists(key), false);
});

Deno.test("cleanup restores the login keychain and removes the work directory, and fails when the restore fails", async () => {
  const { repo, tmp } = await appRepo();
  await write(tmp, "release-ios/certificates/distribution.p12", "p12");
  const { path, log } = await host({ keychain: RECORD });
  const ran = await program(repo, "release-ios", ["cleanup"], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(await log(), "keychain use-login\n");
  assert.equal(await exists(`${tmp}/release-ios`), false);

  await write(tmp, "release-ios/left", "x");
  const broken = await host({ keychain: "exit 3" });
  const failed = await program(repo, "release-ios", ["cleanup"], {
    PATH: broken.path,
    TMPDIR: tmp,
  });
  assert.equal(failed.code, 3);
  assert.equal(failed.stderr, "keychain use-login exited 3\n");
  assert.equal(await exists(`${tmp}/release-ios`), false);
});

Deno.test("cleanup with no keychain tool removes the work directory and says why it restored nothing", async () => {
  const { repo, tmp } = await appRepo();
  await write(tmp, "release-ios/left", "x");
  const { path } = await host({});
  const ran = await program(repo, "release-ios", ["cleanup"], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout,
    `keychain is not installed, so no keychain was initialized\nremoved ${tmp}/release-ios\n`,
  );
  assert.equal(await exists(`${tmp}/release-ios`), false);
});
