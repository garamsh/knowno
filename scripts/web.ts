// Runs make lint, format, test or build over the Next.js app in web/. Where node is not installed it
// skips the step and says why, or fails where CI is set (skip.ts). It installs web/'s locked
// packages when they are missing or older than web/package-lock.json, and builds with the public
// Supabase values of app/config/dev.json unless NEXT_PUBLIC_SUPABASE_* are already set. Where Docker
// answers, test runs the e2e specs against the image and build builds it.
import {
  attached,
  entry,
  fail,
  filtered,
  hasCommand,
  merged,
  read,
  scopeFiles,
  scopeText,
  status,
  succeeds,
} from "./process.ts";
import { skip } from "./skip.ts";

// Every source file under web/ that git tracks or would track; ignored output such as
// node_modules/ and .next/ stays out. Printed beside each count so the coverage reads true.
const SCOPE = ["web/*.ts", "web/*.tsx", "web/*.mjs"];
const FORMAT_SCOPE = [
  ...SCOPE,
  "web/*.json",
  "web/*.css",
  ":!web/package-lock.json",
];
// Vercel-only code: an @vercel/ package, or a route on the edge runtime (docs/architecture/web.md).
const PORTABILITY = "@vercel/|runtime[[:space:]]*=[[:space:]]*[\"']edge[\"']";
const PORTABILITY_CONTROL = [
  "import { kv } from '@vercel/kv';",
  'export const runtime = "edge";',
  "export const runtime = 'nodejs';",
];
const IMAGE = "knowno-web:local";
const HEALTH_TRIES = 60;
const WEB = { cwd: "web" };

type Env = Record<string, string>;

async function modifiedAt(path: string): Promise<number | undefined> {
  try {
    return (await Deno.stat(path)).mtime?.getTime();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Installs web/'s locked packages unless the install is newer than the lock file. */
async function installPackages(): Promise<void> {
  const installed = await modifiedAt("web/node_modules/.package-lock.json");
  const locked = await modifiedAt("web/package-lock.json");
  if (installed === undefined || locked === undefined || installed <= locked) {
    await attached("npm", ["ci", "--no-audit", "--no-fund"], WEB);
  }
}

/** What every tool here runs with: the public values a build freezes. */
async function publicEnv(): Promise<Env> {
  const config = JSON.parse(await Deno.readTextFile("app/config/dev.json"));
  const value = (name: string, key: string) =>
    Deno.env.get(name) || String(config[key] ?? null);
  return {
    NEXT_PUBLIC_SUPABASE_URL: value("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
    ),
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function dockerAnswers(): Promise<boolean> {
  return await succeeds("docker", ["info"]) &&
    await succeeds("docker", ["buildx", "version"]);
}

/** Builds the image quietly; on a failure it prints the build's whole log, so the failing step's
 * own error, such as next build's, reaches the output and CI's log rather than its exit code alone. */
async function buildImage(env: Env): Promise<void> {
  const { code, output } = await merged("docker", [
    "build",
    "--progress=plain",
    "-f",
    "web/Dockerfile",
    "-t",
    IMAGE,
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_URL",
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ".",
  ], { env });
  if (code !== 0) {
    console.error(output);
    fail("the image build from web/Dockerfile failed; its log is above");
  }
}

/** The selected files, relative to web/, where the tools run. */
async function sources(pathspecs: string[]): Promise<string[]> {
  const selected = await scopeFiles(pathspecs);
  if (selected.length === 0) {
    fail(`no file was selected by: ${scopeText(pathspecs)}`);
  }
  return selected.map((file) => file.replace(/^web\//, ""));
}

async function checkPortability(): Promise<void> {
  // The control: the pattern finds each kind of Vercel-only line, so a clean result means none.
  const found = await filtered(
    "grep",
    ["-E", PORTABILITY],
    `${PORTABILITY_CONTROL.join("\n")}\n`,
  );
  if (found.length !== 2) {
    fail(
      `the portability pattern no longer finds both control lines: ${PORTABILITY}`,
    );
  }
  const hit = await status("git", [
    "grep",
    "--untracked",
    "-nE",
    PORTABILITY,
    "--",
    "web",
  ]);
  if (hit === 0) {
    fail(
      "web/ holds Vercel-only code (an @vercel/ package or the edge runtime): docs/architecture/web.md",
    );
  }
  console.log(
    "found no @vercel/ package and no edge runtime in web/ (git grep --untracked over web/), and the pattern found both control lines",
  );
}

/** The FROM lines of a Dockerfile, and how many of them run the Node release. */
export function fromLines(
  dockerfile: string,
  release: string,
): { total: number; onRelease: number } {
  const froms = dockerfile.split("\n").filter((l) => l.startsWith("FROM "));
  const onRelease = froms.filter((l) => l.startsWith(`FROM node:${release}-`));
  return { total: froms.length, onRelease: onRelease.length };
}

async function checkDockerfile(release: string): Promise<void> {
  const dockerfile = await Deno.readTextFile("web/Dockerfile");
  const { total, onRelease } = fromLines(dockerfile, release);
  if (total === 0) fail("web/Dockerfile has no FROM line");
  if (onRelease !== total) {
    fail(
      `every FROM in web/Dockerfile must be node:${release}-..., the release web/.nvmrc names`,
    );
  }
  console.log(
    `checked that the ${total} FROM lines of web/Dockerfile run Node ${release}, as web/.nvmrc does`,
  );
}

async function lint(env: Env, release: string): Promise<void> {
  const files = await sources(SCOPE);
  const inWeb = { ...WEB, env };
  // next typegen writes the route types (PageProps, LayoutProps) both read, as next build would.
  await read("npx", ["next", "typegen"], inWeb);
  await attached("npx", ["eslint", "--max-warnings", "0", ...files], inWeb);
  await attached("npx", ["tsc", "--noEmit"], inWeb);
  console.log(
    `linted ${files.length} files with eslint, type rules included, selected by: ${
      scopeText(SCOPE)
    }; type-checked web/tsconfig.json`,
  );
  await checkPortability();
  await checkDockerfile(release);
  await attached("node", ["tools/brand/generate.mjs", "--check"], { env });
}

async function format(env: Env): Promise<void> {
  const files = await sources(FORMAT_SCOPE);
  await attached(
    "npx",
    ["prettier", "--check", "--log-level", "warn", ...files],
    { ...WEB, env },
  );
  console.log(
    `format checked ${files.length} files with prettier, selected by: ${
      scopeText(FORMAT_SCOPE)
    }`,
  );
}

/** Asks up to `tries` times, `pauseMs` apart; whether it answered. */
export async function answersWithin(
  answers: () => Promise<boolean>,
  tries: number,
  pauseMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt <= tries; attempt++) {
    if (await answers()) return true;
    if (attempt < tries) {
      await new Promise((done) => setTimeout(done, pauseMs));
    }
  }
  return false;
}

/** Checks the running image, then runs the e2e specs against it. */
async function testImage(container: string, env: Env): Promise<void> {
  const ports = await read("docker", ["port", container, "3000/tcp"]);
  const url = `http://${ports.split("\n")[0]}`;
  const health = `${url}/api/health`;
  const answers = () =>
    succeeds("curl", ["--silent", "--fail", "--output", "/dev/null", health]);
  if (!(await answersWithin(answers, HEALTH_TRIES, 1000))) {
    console.error((await merged("docker", ["logs", container])).output);
    fail(`the image did not answer ${health} within 60 s`);
  }
  const uid = (await read("docker", ["exec", container, "id", "-u"])).trim();
  if (uid === "0") fail("the image runs as root");
  console.log(`the image ${IMAGE} answers ${health} and runs as uid ${uid}`);
  await read("npx", ["playwright", "install", "chromium"], { ...WEB, env });
  await attached("npx", ["playwright", "test"], {
    ...WEB,
    env: { ...env, E2E_BASE_URL: url },
  });
  console.log(
    "ran the e2e specs Playwright selects in web/e2e/ against the image; web/e2e/study.spec.ts skips there; scripts/test-web.ts runs every spec against a local stack",
  );
}

async function test(env: Env): Promise<void> {
  await attached("npx", ["vitest", "run"], { ...WEB, env });
  console.log(
    "ran the tests vitest selects in web/: src/**/__tests__/*.test.{ts,tsx}",
  );
  if (!(await dockerAnswers())) {
    skip(
      "the e2e specs in web/e2e/: they run against the image, and docker or docker buildx does not answer",
    );
    return;
  }
  await buildImage(env);
  const container = (await read("docker", [
    "run",
    "--detach",
    "--rm",
    "--publish",
    "127.0.0.1::3000",
    IMAGE,
  ])).trim();
  try {
    await testImage(container, env);
  } finally {
    await read("docker", ["stop", container]);
  }
}

async function build(env: Env): Promise<void> {
  await attached("npx", ["next", "build"], { ...WEB, env });
  console.log("built web/ with next build into web/.next/standalone/");
  if (await dockerAnswers()) {
    await buildImage(env);
    console.log(`built the image ${IMAGE} from web/Dockerfile`);
  } else {
    skip("the image build: docker or docker buildx does not answer");
  }
}

async function main([task]: string[]): Promise<void> {
  if (!(await hasCommand("node"))) {
    skip(`web ${task ?? ""} over web/: this host has no node command`);
    return;
  }
  const want = (await Deno.readTextFile("web/.nvmrc")).trim();
  const have = (await read("node", ["--version"])).trim().replace(/^v/, "");
  if (have !== want) {
    fail(`web/ runs on Node ${want} (web/.nvmrc); this host's node is ${have}`);
  }
  await installPackages();
  const env = await publicEnv();
  if (task === "lint") return await lint(env, want);
  if (task === "format") return await format(env);
  if (task === "test") return await test(env);
  if (task === "build") return await build(env);
  fail("usage: scripts/run.sh web lint|format|test|build", 2);
}

if (import.meta.main) await entry(main);
