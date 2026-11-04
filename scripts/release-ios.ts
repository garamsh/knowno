// The release workflow's steps for the iOS app (docs/architecture/release.md, ADR 0192):
//   check <tag>               refuses unless the tag is v<major>.<minor>.<patch> on a commit of main
//                             that a pull request landed with ci (ubuntu) and ci (macos) passed on
//                             its tree
//   build <run> <config> [tag]  archives the app signed through the App Store Connect API key and
//                             exports it for App Store Connect; with no tag, a dry run as 0.0.0
//   upload                    uploads the exported ipa to App Store Connect
// The key, from APP_STORE_CONNECT_KEY_P8, is written under TMPDIR readable by its owner alone,
// dropped from the environment before any tool starts, and removed when the step ends.
import { attached, entry, fail, read, status } from "./process.ts";

/** The checks a pull request must have passed on the tree a release builds. */
export const REQUIRED_CHECKS = ["ci (ubuntu)", "ci (macos)"];

/** Added to the workflow's run number, so the first build number is 2: TestFlight holds 1.0.0 (1). */
export const BUILD_NUMBER_OFFSET = 1;

/** The entitlements the app is signed with, which the exported app must carry. */
const ENTITLEMENTS = "app/ios/Runner/Runner.entitlements";

/** The version a release tag names, or nothing where the tag is not v<major>.<minor>.<patch>. */
export function versionOf(tag: string): string | undefined {
  return /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag)?.[1];
}

/** The build number of a workflow run, or nothing where the run number is not a positive integer. */
export function buildNumberOf(run: string): number | undefined {
  return /^[1-9]\d*$/.test(run) ? Number(run) + BUILD_NUMBER_OFFSET : undefined;
}

/** The pull request a squash merge names at the end of its subject, as `(#123)`. */
export function pullRequestOf(subject: string): number | undefined {
  const found = /\(#(\d+)\)$/.exec(subject);
  return found ? Number(found[1]) : undefined;
}

type CheckRun = { name: string; status: string; conclusion: string | null };

/** The required checks whose latest run did not succeed, each with what it reported. */
export function unpassed(runs: CheckRun[]): string[] {
  return REQUIRED_CHECKS.flatMap((name) => {
    const run = runs.find((r) => r.name === name);
    if (run === undefined) return [`${name}: no run`];
    return run.conclusion === "success"
      ? []
      : [`${name}: ${run.conclusion ?? run.status}`];
  });
}

/** The export options for App Store Connect, signed automatically for the team. */
export function exportOptions(team: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>export</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${team}</string>
</dict>
</plist>
`;
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") fail(`${name} is not set`);
  return value;
}

const work = () => `${required("TMPDIR")}/release-ios`;
const exported = () => `${work()}/export`;

async function gh(path: string): Promise<unknown> {
  return JSON.parse(await read("gh", ["api", path]));
}

async function check(tag: string): Promise<void> {
  const version = versionOf(tag);
  if (version === undefined) {
    fail(
      `the tag "${tag}" is not v<major>.<minor>.<patch>; nothing is released`,
    );
  }
  const repo = required("GITHUB_REPOSITORY");
  const sha =
    (await read("git", ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]))
      .trim();
  const onMain = await status("git", [
    "merge-base",
    "--is-ancestor",
    sha,
    "refs/remotes/origin/main",
  ]);
  if (onMain !== 0) {
    fail(`${tag} is ${sha}, which is not on main; nothing is released`);
  }

  const subject = (await read("git", ["log", "-1", "--format=%s", sha])).trim();
  const number = pullRequestOf(subject);
  if (number === undefined) {
    fail(
      `${sha} names no pull request at the end of its subject, so no CI run vouches for it: ${subject}`,
    );
  }
  const pull = await gh(`repos/${repo}/pulls/${number}`) as {
    merge_commit_sha: string | null;
    head: { sha: string };
  };
  if (pull.merge_commit_sha !== sha) {
    fail(
      `pull request #${number} merged as ${pull.merge_commit_sha}, not ${sha}; nothing is released`,
    );
  }
  const head = pull.head.sha;
  const tree = (await read("git", ["rev-parse", `${sha}^{tree}`])).trim();
  const headTree =
    (await gh(`repos/${repo}/git/commits/${head}`) as { tree: { sha: string } })
      .tree.sha;
  if (headTree !== tree) {
    fail(
      `pull request #${number}'s head ${head} holds tree ${headTree}, and ${sha} holds ${tree}, so its CI run did not test what ${tag} builds`,
    );
  }
  const runs: CheckRun[] = [];
  for (const name of REQUIRED_CHECKS) {
    const found = await gh(
      `repos/${repo}/commits/${head}/check-runs?check_name=${
        encodeURIComponent(name)
      }&filter=latest`,
    ) as { check_runs: CheckRun[] };
    runs.push(...found.check_runs);
  }
  const failed = unpassed(runs);
  if (failed.length > 0) {
    fail(
      `pull request #${number}'s CI did not pass on ${head}; nothing is released:\n${
        failed.join("\n")
      }`,
    );
  }
  console.log(
    `${tag} is ${sha} on main, landed by pull request #${number}, whose head ${head} holds the same tree and passed ${
      REQUIRED_CHECKS.join(" and ")
    }: releasing ${version}`,
  );
}

/** Writes the key readable by its owner alone and drops it from the environment the tools inherit. */
async function writeKey(): Promise<
  { path: string; id: string; issuer: string }
> {
  const key = required("APP_STORE_CONNECT_KEY_P8");
  Deno.env.delete("APP_STORE_CONNECT_KEY_P8");
  const id = required("APP_STORE_CONNECT_KEY_ID");
  const issuer = required("APP_STORE_CONNECT_ISSUER_ID");
  await Deno.mkdir(work(), { recursive: true, mode: 0o700 });
  const path = `${work()}/AuthKey_${id}.p8`;
  await Deno.remove(path).catch(() => {});
  await Deno.writeTextFile(path, key, { mode: 0o600, createNew: true });
  return { path, id, issuer };
}

async function withKey(
  step: (key: { path: string; id: string; issuer: string }) => Promise<void>,
): Promise<void> {
  const key = await writeKey();
  try {
    await step(key);
  } finally {
    await Deno.remove(key.path);
  }
}

async function theIpa(): Promise<string> {
  const ipas: string[] = [];
  for await (const { name } of Deno.readDir(exported())) {
    if (name.endsWith(".ipa")) ipas.push(`${exported()}/${name}`);
  }
  if (ipas.length !== 1) {
    fail(`${exported()} holds ${ipas.length} .ipa files, not one`);
  }
  return ipas[0];
}

async function build(run: string, config: string, tag?: string): Promise<void> {
  const number = buildNumberOf(run);
  if (number === undefined) {
    fail(`the run number "${run}" is not a positive integer`);
  }
  const version = tag === undefined ? "0.0.0" : versionOf(tag);
  if (version === undefined) {
    fail(`the tag "${tag}" is not v<major>.<minor>.<patch>`);
  }
  const team = required("APPLE_TEAM_ID");
  await withKey(async (key) => {
    const auth = [
      "-allowProvisioningUpdates",
      "-authenticationKeyPath",
      key.path,
      "-authenticationKeyID",
      key.id,
      "-authenticationKeyIssuerID",
      key.issuer,
    ];
    const archive = `${work()}/Runner.xcarchive`;
    const options = `${work()}/ExportOptions.plist`;
    await Deno.writeTextFile(options, exportOptions(team));
    await Deno.remove(exported(), { recursive: true }).catch(() => {});

    await attached("flutter", [
      "build",
      "ios",
      "--release",
      "--no-codesign",
      "--config-only",
      config,
      `--build-name=${version}`,
      `--build-number=${number}`,
    ], { cwd: "app" });
    await attached("xcodebuild", [
      "archive",
      "-workspace",
      "Runner.xcworkspace",
      "-scheme",
      "Runner",
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archive,
      ...auth,
      `DEVELOPMENT_TEAM=${team}`,
      "CODE_SIGN_STYLE=Automatic",
    ], { cwd: "app/ios" });
    await attached("xcodebuild", [
      "-exportArchive",
      "-archivePath",
      archive,
      "-exportPath",
      exported(),
      "-exportOptionsPlist",
      options,
      ...auth,
    ]);
  });
  await verify(await theIpa(), version, String(number));
  if (tag === undefined) {
    console.log("no tag was given, so this was a dry run as 0.0.0");
  }
}

/** The entitlement keys an entitlements plist grants. */
export function entitlementKeys(plist: string): string[] {
  return [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
}

/** Fails unless the ipa holds the version and build number asked for, signed with the app's entitlements. */
async function verify(
  ipa: string,
  version: string,
  number: string,
): Promise<void> {
  const unpacked = `${work()}/unpacked`;
  await Deno.remove(unpacked, { recursive: true }).catch(() => {});
  await attached("unzip", ["-q", ipa, "-d", unpacked]);
  const apps: string[] = [];
  for await (const { name } of Deno.readDir(`${unpacked}/Payload`)) {
    if (name.endsWith(".app")) apps.push(`${unpacked}/Payload/${name}`);
  }
  if (apps.length !== 1) fail(`${ipa} holds ${apps.length} apps, not one`);
  const app = apps[0];
  const key = async (name: string) =>
    (await read("plutil", ["-extract", name, "raw", `${app}/Info.plist`]))
      .trim();
  const found = {
    version: await key("CFBundleShortVersionString"),
    number: await key("CFBundleVersion"),
  };
  if (found.version !== version || found.number !== number) {
    fail(
      `${ipa} holds ${found.version} (${found.number}), not ${version} (${number})`,
    );
  }
  await attached("codesign", ["--verify", "--strict", app]);
  const signed = entitlementKeys(
    await read("codesign", ["-d", "--entitlements", "-", "--xml", app]),
  );
  const wanted = entitlementKeys(await Deno.readTextFile(ENTITLEMENTS));
  const missing = wanted.filter((name) => !signed.includes(name));
  if (missing.length > 0) {
    fail(
      `${app} is signed without ${
        missing.join(", ")
      }, which ${ENTITLEMENTS} grants`,
    );
  }
  console.log(
    `exported ${ipa}: ${version} (${number}), signed for App Store Connect with the ${wanted.length} entitlement keys of ${ENTITLEMENTS}`,
  );
}

async function upload(): Promise<void> {
  const ipa = await theIpa();
  await withKey((key) =>
    attached("xcrun", [
      "altool",
      "--upload-package",
      ipa,
      "--api-key",
      key.id,
      "--api-issuer",
      key.issuer,
      "--p8-file-path",
      key.path,
      "--wait",
    ])
  );
  console.log(`uploaded ${ipa} to App Store Connect`);
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "check" && rest.length === 1) return await check(rest[0]);
  if (command === "build" && (rest.length === 2 || rest.length === 3)) {
    return await build(rest[0], rest[1], rest[2] || undefined);
  }
  if (command === "upload" && rest.length === 0) return await upload();
  fail(
    "usage: release-ios check <tag> | build <run> <config> [tag] | upload",
    2,
  );
}

if (import.meta.main) await entry(main);
