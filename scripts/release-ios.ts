// The release workflow's steps for the iOS app (docs/architecture/release.md, ADR 0192), through
// Codemagic CLI tools as Flutter's "Build and release an iOS app" shows them:
//   check <tag>               refuses unless the tag is v<major>.<minor>.<patch> on a commit of main
//                             that a pull request landed with ci (ubuntu) and ci (macos) passed on
//                             its tree
//   build <run> <config> [tag]  fetches the App Store signing files into a signing keychain, creating
//                             the certificate from IOS_DISTRIBUTION_CERT_PRIVATE_KEY where none
//                             matches it, and builds the ipa; with no tag, an unsigned dry run as
//                             0.0.0 that reads no key
//   upload                    publishes the ipa to App Store Connect
//   cleanup                   restores the login keychain, deletes the signing keychain and removes
//                             what the steps wrote
// Each key file is written under TMPDIR readable by its owner alone, dropped from the environment
// before any tool starts, and removed when the step ends. The signing keychain holds the
// certificate's private key until cleanup deletes it.
import { attached, entry, fail, read, status } from "./process.ts";

/** The checks a pull request must have passed on the tree a release builds. */
export const REQUIRED_CHECKS = ["ci (ubuntu)", "ci (macos)"];

/** The GitHub Actions app, the one branch protection requires those checks from. */
const GITHUB_ACTIONS_APP = 15368;

/** Added to the workflow's run number, so the first build number is 2: TestFlight holds 1.0.0 (1). */
export const BUILD_NUMBER_OFFSET = 1;

/** The app's bundle identifier, whose App Store profile the build fetches. */
const BUNDLE_ID = "app.knowno";

/** The entitlements the app is signed with, which the exported app must carry. */
const ENTITLEMENTS = "app/ios/Runner/Runner.entitlements";

/** Where flutter build ipa writes the ipa, relative to the repository. */
const IPA_DIR = "app/build/ios/ipa";

/** Where flutter build ipa --no-codesign writes the archive, relative to the repository. */
const ARCHIVE = "app/build/ios/archive/Runner.xcarchive";

/** The uv project that pins Codemagic CLI tools. */
const TOOLS = "tools/release";

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

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") fail(`${name} is not set`);
  return value;
}

const work = () => `${required("TMPDIR")}/release-ios`;

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
      }&filter=latest&app_id=${GITHUB_ACTIONS_APP}`,
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

/** Removes a path, recursively where asked; a path already gone is no error, and any other failure is. */
async function removeIfPresent(path: string, recursive = false): Promise<void> {
  try {
    await Deno.remove(path, { recursive });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Writes a secret readable by its owner alone and drops it from the environment the tools inherit. */
async function writeSecret(variable: string, file: string): Promise<string> {
  const value = required(variable);
  Deno.env.delete(variable);
  await Deno.mkdir(work(), { recursive: true, mode: 0o700 });
  const path = `${work()}/${file}`;
  await removeIfPresent(path);
  await Deno.writeTextFile(path, value, { mode: 0o600, createNew: true });
  return path;
}

/**
 * Runs the step with the files named by `secrets` (variable to file name), then removes every one of
 * them. A removal that fails is reported and fails the program, after the step's own error if any.
 */
async function withSecrets(
  secrets: Record<string, string>,
  step: (paths: Record<string, string>) => Promise<void>,
): Promise<void> {
  const paths: Record<string, string> = {};
  let outcome: { error: unknown } | undefined;
  try {
    for (const [variable, file] of Object.entries(secrets)) {
      paths[variable] = await writeSecret(variable, file);
    }
    await step(paths);
  } catch (error) {
    outcome = { error };
  }
  const unremoved: unknown[] = [];
  for (const path of Object.values(paths)) {
    try {
      await removeIfPresent(path);
    } catch (error) {
      console.error(`could not remove ${path}: ${error}`);
      unremoved.push(error);
    }
  }
  if (outcome !== undefined) throw outcome.error;
  if (unremoved.length > 0) throw unremoved[0];
}

/** The App Store Connect key's arguments: the IDs read from the environment, the key from its file. */
function apiKey(path: string): string[] {
  return [
    "--issuer-id",
    "@env:APP_STORE_CONNECT_ISSUER_ID",
    "--key-id",
    "@env:APP_STORE_CONNECT_KEY_ID",
    "--private-key",
    `@file:${path}`,
    "--disable-jwt-cache",
  ];
}

const API_KEY = "APP_STORE_CONNECT_KEY_P8";
const CERTIFICATE_KEY = "IOS_DISTRIBUTION_CERT_PRIVATE_KEY";

/** Runs one of Codemagic CLI tools at the release tools/release/uv.lock pins. */
function codemagic(
  tool: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  return attached("uv", [
    "run",
    "--project",
    TOOLS,
    "--locked",
    tool,
    ...args,
  ], options.cwd ? { cwd: options.cwd } : {});
}

const keychain = () => `${work()}/signing.keychain-db`;

async function theIpa(): Promise<string> {
  const ipas: string[] = [];
  for await (const { name } of Deno.readDir(IPA_DIR)) {
    if (name.endsWith(".ipa")) ipas.push(`${IPA_DIR}/${name}`);
  }
  if (ipas.length !== 1) {
    fail(`${IPA_DIR} holds ${ipas.length} .ipa files, not one`);
  }
  return ipas[0];
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
  required("APP_STORE_CONNECT_KEY_ID");
  required("APP_STORE_CONNECT_ISSUER_ID");
  const certificates = `${work()}/certificates`;
  const options = `${work()}/export_options.plist`;
  await withSecrets(
    { [API_KEY]: "api_key.p8", [CERTIFICATE_KEY]: "certificate_key.pem" },
    async (paths) => {
      await codemagic("keychain", ["initialize", "--path", keychain()]);
      await codemagic("app-store-connect", [
        "fetch-signing-files",
        BUNDLE_ID,
        "--platform",
        "IOS",
        "--type",
        "IOS_APP_STORE",
        "--certificate-key",
        `@file:${paths[CERTIFICATE_KEY]}`,
        "--create",
        "--strict-match-identifier",
        "--certificates-dir",
        certificates,
        ...apiKey(paths[API_KEY]),
      ]);
      await codemagic("keychain", [
        "add-certificates",
        "--path",
        keychain(),
        "--certificate",
        `${certificates}/*.p12`,
      ]);
    },
  );
  await Deno.remove(certificates, { recursive: true });
  await codemagic("xcode-project", [
    "use-profiles",
    "--project",
    "ios/Runner.xcodeproj",
    "--export-options-plist",
    options,
  ], { cwd: "app" });
  await removeIfPresent(IPA_DIR, true);
  await attached("flutter", [
    "build",
    "ipa",
    "--release",
    config,
    `--build-name=${version}`,
    `--build-number=${number}`,
    `--export-options-plist=${options}`,
  ], { cwd: "app" });
  await verify(await theIpa(), version, String(number));
}

/** Fails unless the app's Info.plist holds the version and build number asked for. */
async function checkVersion(
  what: string,
  app: string,
  version: string,
  number: string,
): Promise<void> {
  const key = async (name: string) =>
    (await read("plutil", ["-extract", name, "raw", `${app}/Info.plist`]))
      .trim();
  const found = {
    version: await key("CFBundleShortVersionString"),
    number: await key("CFBundleVersion"),
  };
  if (found.version !== version || found.number !== number) {
    fail(
      `${what} holds ${found.version} (${found.number}), not ${version} (${number})`,
    );
  }
}

/** Builds the release unsigned as 0.0.0, with no key and no signing tool: a pull request's dry run. */
async function dryRun(config: string, number: number): Promise<void> {
  const version = "0.0.0";
  await removeIfPresent(ARCHIVE, true);
  await attached("flutter", [
    "build",
    "ipa",
    "--release",
    "--no-codesign",
    config,
    `--build-name=${version}`,
    `--build-number=${number}`,
  ], { cwd: "app" });
  await checkVersion(
    ARCHIVE,
    `${ARCHIVE}/Products/Applications/Runner.app`,
    version,
    String(number),
  );
  console.log(
    `built the unsigned archive ${ARCHIVE}: ${version} (${number}); no tag was given, so this dry run signed and uploaded nothing`,
  );
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
  await removeIfPresent(unpacked, true);
  await attached("unzip", ["-q", ipa, "-d", unpacked]);
  const apps: string[] = [];
  for await (const { name } of Deno.readDir(`${unpacked}/Payload`)) {
    if (name.endsWith(".app")) apps.push(`${unpacked}/Payload/${name}`);
  }
  if (apps.length !== 1) fail(`${ipa} holds ${apps.length} apps, not one`);
  const app = apps[0];
  await checkVersion(ipa, app, version, number);
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
  required("APP_STORE_CONNECT_KEY_ID");
  required("APP_STORE_CONNECT_ISSUER_ID");
  await withSecrets(
    { [API_KEY]: "api_key.p8" },
    (paths) =>
      codemagic("app-store-connect", [
        "publish",
        "--path",
        ipa,
        ...apiKey(paths[API_KEY]),
      ]),
  );
  console.log(`uploaded ${ipa} to App Store Connect`);
}

/**
 * Makes the login keychain the default again, as the doc requires after keychain initialize, deletes
 * the signing keychain with the certificate's private key, and removes what the steps wrote.
 */
async function cleanup(): Promise<void> {
  let restored: number | undefined;
  try {
    restored = await status("uv", [
      "run",
      "--project",
      TOOLS,
      "--locked",
      "keychain",
      "use-login",
    ]);
    if (await exists(keychain())) {
      await codemagic("keychain", ["delete", "--path", keychain()]);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    console.log("uv is not installed, so no keychain was initialized");
  }
  await removeIfPresent(work(), true);
  console.log(`removed ${work()}`);
  if (restored !== undefined && restored !== 0) {
    fail(`keychain use-login exited ${restored}`, restored);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "check" && rest.length === 1) return await check(rest[0]);
  if (command === "build" && (rest.length === 2 || rest.length === 3)) {
    return await build(rest[0], rest[1], rest[2] || undefined);
  }
  if (command === "upload" && rest.length === 0) return await upload();
  if (command === "cleanup" && rest.length === 0) return await cleanup();
  fail(
    "usage: release-ios check <tag> | build <run> <config> [tag] | upload | cleanup",
    2,
  );
}

if (import.meta.main) await entry(main);
