// scripts/release-ios.ts against stubs of gh, flutter, xcodebuild, unzip, plutil, codesign and xcrun.
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
  APPLE_TEAM_ID: "TEAM9",
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

Deno.test("check refuses a tag not of the form, before asking GitHub anything", async () => {
  const { repo } = await landed();
  await git(repo, "tag", "v1.2.3-rc1");
  const { path, log } = await host({ gh: RECORD });
  const ran = await checked(repo, path, "v1.2.3-rc1");
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    `the tag "v1.2.3-rc1" is not v<major>.<minor>.<patch>; nothing is released\n`,
  );
  assert.equal(await log(), "");
});

Deno.test("check refuses a tag on a commit main does not hold", async () => {
  const { repo, tree } = await landed();
  await write(repo, "README.md", "y\n");
  await commit(repo, "feat: off main (#8)");
  await git(repo, "tag", "v1.2.3");
  const sha = await git(repo, "rev-parse", "HEAD");
  const { path } = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    `v1.2.3 is ${sha}, which is not on main; nothing is released\n`,
  );
});

Deno.test("check refuses a commit no pull request landed", async () => {
  const { repo, sha, tree } = await landed("feat: pushed straight to main");
  await git(repo, "tag", "v1.2.3");
  const { path } = await host({ gh: gh({ merge: sha, head: "abc" }, tree) });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /names no pull request at the end of its subject/);
});

Deno.test("check refuses where the pull request merged as another commit", async () => {
  const { repo, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const { path } = await host({ gh: gh({ merge: "f00", head: "abc" }, tree) });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /^pull request #7 merged as f00, not /);
});

Deno.test("check refuses where the pull request's head holds another tree", async () => {
  const { repo, sha } = await landed();
  await git(repo, "tag", "v1.2.3");
  const { path } = await host({ gh: gh({ merge: sha, head: "abc" }, "0ther") });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /holds tree 0ther, .* so its CI run did not test what v1\.2\.3 builds\n$/,
  );
});

Deno.test("check refuses where a required check did not pass", async () => {
  const { repo, sha, tree } = await landed();
  await git(repo, "tag", "v1.2.3");
  const { path } = await host({
    gh: gh({ merge: sha, head: "abc" }, tree, "failure"),
  });
  const ran = await checked(repo, path);
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "pull request #7's CI did not pass on abc; nothing is released:\nci (macos): failure\n",
  );
});

/** Stubs of the build's tools; the exported app holds `version` (`number`) and `entitled`. */
function buildTools(version: string, number: string, entitled: string) {
  const log = `"$(dirname "$0")/calls"`;
  return {
    flutter: RECORD,
    xcodebuild: `${RECORD}
prev=; for a in "$@"; do case $prev in -exportPath) out=$a ;; -authenticationKeyPath) key=$a ;; esac; prev=$a; done
echo "key mode $(/bin/ls -l "$key" | sed -E 's/^(.{10}).*/\\1/'), holds $(cat "$key" | sed -n 2p), P8 in env: \${APP_STORE_CONNECT_KEY_P8:-no}" >>${log}
if [ "$1" = -exportArchive ]; then /bin/mkdir -p "$out" && echo ipa >"$out/knowno.ipa"; cat "$7" >>${log}; fi`,
    unzip: `${RECORD}\n/bin/mkdir -p "$4/Payload/Runner.app"`,
    plutil:
      `case "$2" in CFBundleShortVersionString) echo ${version} ;; CFBundleVersion) echo ${number} ;; esac`,
    codesign:
      `${RECORD}\n[ "$1" = -d ] && echo '<key>application-identifier</key><key>${entitled}</key>'; exit 0`,
    xcrun: `${RECORD}
prev=; for a in "$@"; do [ "$prev" = --p8-file-path ] && key=$a; prev=$a; done
echo "key mode $(/bin/ls -l "$key" | sed -E 's/^(.{10}).*/\\1/')" >>${log}`,
  };
}

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
    { PATH: path, TMPDIR: tmp, ...KEY },
  );

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

Deno.test("build archives and exports with the key alone, the key owner-only and removed after", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(
    buildTools("1.2.3", "8", "com.apple.developer.applesignin"),
  );
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 0, ran.stderr);
  const key = `${tmp}/release-ios/AuthKey_KEY123.p8`;
  const calls = await log();
  assert.ok(
    calls.includes(
      "flutter build ios --release --no-codesign --config-only --dart-define-from-file=config/dev.json --build-name=1.2.3 --build-number=8\n",
    ),
    calls,
  );
  const auth =
    `-allowProvisioningUpdates -authenticationKeyPath ${key} -authenticationKeyID KEY123 -authenticationKeyIssuerID issuer-1`;
  assert.ok(
    calls.includes(
      `xcodebuild archive -workspace Runner.xcworkspace -scheme Runner -configuration Release -destination generic/platform=iOS -archivePath ${tmp}/release-ios/Runner.xcarchive ${auth} DEVELOPMENT_TEAM=TEAM9 CODE_SIGN_STYLE=Automatic\n`,
    ),
    calls,
  );
  assert.ok(
    calls.includes(
      `-exportOptionsPlist ${tmp}/release-ios/ExportOptions.plist ${auth}\n`,
    ),
    calls,
  );
  assert.equal(
    calls.split("\n").filter((l) => l.startsWith("key mode")).join("\n"),
    "key mode -rw-------, holds secret, P8 in env: no\nkey mode -rw-------, holds secret, P8 in env: no",
  );
  assert.ok(calls.includes("<string>app-store-connect</string>"), calls);
  assert.ok(
    calls.includes("<key>teamID</key>\n\t<string>TEAM9</string>"),
    calls,
  );
  assert.equal(await exists(key), false);
  assert.equal(
    ran.stdout,
    `exported ${tmp}/release-ios/export/knowno.ipa: 1.2.3 (8), signed for App Store Connect with the 1 entitlement keys of ${ENTITLEMENTS}\n`,
  );
});

Deno.test("build with no tag is a dry run as 0.0.0", async () => {
  const { repo, tmp } = await appRepo();
  const { path, log } = await host(
    buildTools("0.0.0", "8", "com.apple.developer.applesignin"),
  );
  const ran = await built(repo, path, tmp);
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok((await log()).includes("--build-name=0.0.0 --build-number=8\n"));
  assert.ok(
    ran.stdout.endsWith("no tag was given, so this was a dry run as 0.0.0\n"),
    ran.stdout,
  );
});

Deno.test("build fails on an ipa of another version, or signed without the app's entitlements", async () => {
  const { repo, tmp } = await appRepo();
  const other = await host(
    buildTools("1.2.3", "1", "com.apple.developer.applesignin"),
  );
  const stale = await built(repo, other.path, tmp, "v1.2.3");
  assert.equal(stale.code, 1);
  assert.equal(
    stale.stderr,
    `${tmp}/release-ios/export/knowno.ipa holds 1.2.3 (1), not 1.2.3 (8)\n`,
  );

  const bare = await host(buildTools("1.2.3", "8", "get-task-allow"));
  const unentitled = await built(repo, bare.path, tmp, "v1.2.3");
  assert.equal(unentitled.code, 1);
  assert.equal(
    unentitled.stderr,
    `${tmp}/release-ios/unpacked/Payload/Runner.app is signed without com.apple.developer.applesignin, which ${ENTITLEMENTS} grants\n`,
  );
});

Deno.test("build removes the key when a tool fails", async () => {
  const { repo, tmp } = await appRepo();
  const { path } = await host({
    ...buildTools("1.2.3", "8", "x"),
    xcodebuild: "exit 65",
  });
  const ran = await built(repo, path, tmp, "v1.2.3");
  assert.equal(ran.code, 65);
  assert.equal(await exists(`${tmp}/release-ios/AuthKey_KEY123.p8`), false);
});

Deno.test("upload sends the exported ipa through altool with the key, removed after", async () => {
  const { repo, tmp } = await appRepo();
  await Deno.mkdir(`${tmp}/release-ios/export`, { recursive: true });
  await Deno.writeTextFile(`${tmp}/release-ios/export/knowno.ipa`, "ipa");
  const { path, log } = await host(buildTools("1.2.3", "8", "x"));
  const ran = await program(repo, "release-ios", ["upload"], {
    PATH: path,
    TMPDIR: tmp,
    ...KEY,
  });
  assert.equal(ran.code, 0, ran.stderr);
  const key = `${tmp}/release-ios/AuthKey_KEY123.p8`;
  assert.equal(
    await log(),
    `xcrun altool --upload-package ${tmp}/release-ios/export/knowno.ipa --api-key KEY123 --api-issuer issuer-1 --p8-file-path ${key} --wait\nkey mode -rw-------\n`,
  );
  assert.equal(await exists(key), false);
});
