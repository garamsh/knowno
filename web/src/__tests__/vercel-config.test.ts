// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

const config = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../../vercel.json"), "utf8"),
) as Record<string, unknown>;

describe("web/vercel.json", () => {
  it("runs the functions in hnd1, beside the Supabase project in Tokyo, and sets only the region and the Ignored Build Step", () => {
    // Neither changes what the app does: any other key would be behaviour the container, which ignores this file, lacks.
    expect(config).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      regions: ["hnd1"],
      ignoreCommand: expect.any(String) as unknown,
    });
  });
});

// One file in each place a change can land: the web build's inputs, and the folders it never reads.
const FILES = [
  "web/package.json",
  "web/src/app/page.tsx",
  "app/assets/fonts/Jua-Regular.ttf",
  "app/lib/main.dart",
  "engine-wasm/pkg/knowno_engine_wasm.js",
  "engine-wasm/src/lib.rs",
  "engine/src/lib.rs",
  "supabase/migrations/1_init.sql",
  "docs/architecture/web.md",
  "scripts/web.ts",
  ".github/workflows/ci.yml",
  ".gitignore",
  "Makefile",
];

let repo = "";

afterEach(() => {
  if (repo !== "") rmSync(repo, { recursive: true, force: true });
  repo = "";
});

function git(...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: repo, encoding: "utf8" },
  ).trim();
}

/** A repository holding every file of FILES, committed once; returns that commit. */
function deployed(): string {
  repo = mkdtempSync(path.join(tmpdir(), "vercel-ignore-"));
  git("init", "-q", "-b", "main");
  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), "first\n");
  }
  git("add", "-A");
  git("commit", "-q", "-m", "deployed");
  return git("rev-parse", "HEAD");
}

/** Commits a change to each of the paths. */
function push(paths: string[]): void {
  for (const file of paths) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), "changed\n");
  }
  git("add", "-A");
  git("commit", "-q", "-m", "pushed");
}

/** The ignoreCommand's exit code, run as Vercel runs it: in the Root Directory, web/. */
function ignoreStep(previous: string | undefined): number {
  // env -i: the command sees PATH and HOME, and the previous SHA only where the test sets it.
  const env = [`PATH=${process.env.PATH ?? ""}`, `HOME=${process.env.HOME ?? ""}`];
  if (previous !== undefined) env.push(`VERCEL_GIT_PREVIOUS_SHA=${previous}`);
  const ran = spawnSync("env", ["-i", ...env, "sh", "-c", config.ignoreCommand as string], {
    cwd: path.join(repo, "web"),
  });
  if (ran.status === null) throw new Error(`the ignoreCommand ended by ${String(ran.signal)}`);
  return ran.status;
}

// Vercel skips the build where the command exits 0 and builds where it exits 1 or more.
const SKIPS = 0;

/** The paths changed between the commits, as the test's setup must have left them. */
function changedSince(previous: string): string[] {
  return git("diff", "--name-only", "--no-renames", previous, "HEAD").split("\n").sort();
}

describe("web/vercel.json's ignoreCommand", () => {
  it.each([
    ["web/", ["web/src/app/page.tsx"]],
    ["web/'s own package files", ["web/package.json"]],
    ["the fonts web/src/styles/fonts links to", ["app/assets/fonts/Jua-Regular.ttf"]],
    [
      "the engine module web/src/features/study/engine-wasm links to",
      ["engine-wasm/pkg/knowno_engine_wasm.js"],
    ],
    ["the root .gitignore, which Tailwind's source scan honours", [".gitignore"]],
    [
      "web/ among changes the build does not read",
      ["docs/architecture/web.md", "app/lib/main.dart", "web/src/app/page.tsx"],
    ],
  ])("builds when %s changed", (_, paths) => {
    const previous = deployed();
    push(paths);
    expect(changedSince(previous)).toEqual([...paths].sort());

    expect(ignoreStep(previous)).toBeGreaterThan(SKIPS);
  });

  it.each([
    ["app/ alone", ["app/lib/main.dart"]],
    ["supabase/ alone", ["supabase/migrations/1_init.sql"]],
    ["docs/ alone", ["docs/architecture/web.md"]],
    ["the engine's Rust source alone", ["engine/src/lib.rs", "engine-wasm/src/lib.rs"]],
    ["the repository's tooling alone", ["scripts/web.ts", ".github/workflows/ci.yml", "Makefile"]],
  ])("skips when %s changed, and builds once web/ changes too", (_, paths) => {
    const previous = deployed();
    push(paths);
    expect(changedSince(previous)).toEqual([...paths].sort());

    expect(ignoreStep(previous)).toBe(SKIPS);

    // The control: the same push with one web input in it builds.
    push(["web/src/app/page.tsx"]);
    expect(ignoreStep(previous)).toBeGreaterThan(SKIPS);
  });

  it("compares with the last deployed commit, not the one before HEAD, so an earlier commit of the push counts", () => {
    const previous = deployed();
    push(["web/src/app/page.tsx"]);
    push(["docs/architecture/web.md"]);

    expect(ignoreStep(previous)).toBeGreaterThan(SKIPS);
    // The control: against HEAD^, the last commit alone, the same push would skip.
    expect(ignoreStep(git("rev-parse", "HEAD^"))).toBe(SKIPS);
  });

  it("builds a file moved out of web/, whose old path is a web input", () => {
    const previous = deployed();
    git("mv", "web/src/app/page.tsx", "docs/page.tsx");
    git("commit", "-q", "-m", "moved");
    expect(changedSince(previous)).toEqual(["docs/page.tsx", "web/src/app/page.tsx"]);

    expect(ignoreStep(previous)).toBeGreaterThan(SKIPS);
  });

  it("builds a branch's first deployment, which has no previous SHA", () => {
    deployed();
    push(["docs/architecture/web.md"]);

    expect(ignoreStep(undefined)).toBeGreaterThan(SKIPS);
    expect(ignoreStep("")).toBeGreaterThan(SKIPS);
  });

  it("names every place outside web/ the build reads: each link under web/, and each of next.config.ts's turbopackAdditionalRoots", () => {
    const web = path.join(import.meta.dirname, "../..");
    const top = path.join(web, "..");
    const inputs = (config.ignoreCommand as string)
      .split(" -- ")[1]!
      .split(" ")
      .map((spec) => path.relative(top, path.join(web, spec)));
    const links = execFileSync("git", ["ls-files", "-s", "--", "."], { cwd: web, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.startsWith("120000 "))
      .map((line) => path.join(web, line.split("\t")[1]!))
      .map((link) => path.join(path.dirname(link), readlinkSync(link)));
    const roots = Object.values(nextConfig.experimental?.turbopackAdditionalRoots ?? {}).map(
      (root) => root.path,
    );
    const outside = [...new Set([...links, ...roots].map((target) => path.relative(top, target)))]
      .filter((target) => !target.startsWith("web/"))
      .sort();

    // What the build reads outside web/ today; a new link or root has to be added here and to the command.
    expect(outside).toEqual(["app/assets/fonts", "engine-wasm/pkg"]);
    for (const target of outside) {
      expect(inputs.some((input) => target === input || target.startsWith(`${input}/`))).toBe(true);
    }
  });

  it("builds when the previous SHA is not in the clone, as past a shallow clone's depth", () => {
    deployed();
    push(["docs/architecture/web.md"]);

    expect(ignoreStep("0123456789abcdef0123456789abcdef01234567")).toBeGreaterThan(SKIPS);
  });
});
