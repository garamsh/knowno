// scripts/web.ts on a repository holding the files it reads, against stubs of node, npm, npx, docker
// and curl.
import assert from "node:assert/strict";
import { answersWithin, fromLines } from "./web.ts";
import { commit, host, program, RECORD, repository, write } from "./testing.ts";

const CONFIG = JSON.stringify({
  SUPABASE_URL: "https://config.example",
  SUPABASE_PUBLISHABLE_KEY: "config-key",
});
const NODE = `if [ "$1" = --version ]; then echo v24.22.0; exit; fi\n${RECORD}`;
const NPX =
  `${RECORD}\necho "env url=$NEXT_PUBLIC_SUPABASE_URL key=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e2e=$E2E_BASE_URL" >>"$(dirname "$0")/calls"`;
const DOCKER = `${RECORD}
case "$1" in
run) echo the-container ;;
port) echo 127.0.0.1:5000; echo "[::1]:5000" ;;
exec) echo "\${IMAGE_UID:-1000}" ;;
esac`;
const stubs = (overrides: Record<string, string> = {}) => ({
  node: NODE,
  npm: RECORD,
  npx: NPX,
  docker: DOCKER,
  curl: RECORD,
  ...overrides,
});
const without = (name: string) => {
  const set: Record<string, string> = stubs();
  delete set[name];
  return set;
};

async function fixture(): Promise<string> {
  const repo = await repository();
  await write(repo, "web/.nvmrc", "24.22.0\n");
  await write(repo, "web/package-lock.json", "{}\n");
  await write(repo, "web/node_modules/.package-lock.json", "{}\n");
  const past = new Date(Date.now() - 60_000);
  await Deno.utime(`${repo}/web/package-lock.json`, past, past);
  await write(repo, ".gitignore", "web/node_modules/\n");
  await write(
    repo,
    "web/Dockerfile",
    "FROM node:24.22.0-slim\nRUN x\nFROM node:24.22.0-slim AS run\n",
  );
  await write(repo, "web/a.ts", "export const a = 1;\n");
  await write(repo, "web/b.json", "{}\n");
  await write(repo, "app/config/dev.json", CONFIG);
  await commit(repo, "web");
  return repo;
}

const LINT_SCOPE =
  "git ls-files --cached --others --exclude-standard -- 'web/*.ts' 'web/*.tsx' 'web/*.mjs'";

Deno.test("without node it skips, and fails where CI is set", async () => {
  const { path } = await host(without("node"));
  const repo = await fixture();
  const local = await program(repo, "web", ["lint"], { PATH: path });
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped web lint over web/: this host has no node command\n",
  );
  const ci = await program(repo, "web", ["lint"], { PATH: path, CI: "true" });
  assert.equal(ci.code, 1);
  assert.match(ci.stderr, /^did not run web lint over web\//);
});

Deno.test("fails on a Node other than the release web/.nvmrc names", async () => {
  const { path } = await host(stubs({ node: `echo v20.0.0` }));
  const ran = await program(await fixture(), "web", ["format"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "web/ runs on Node 24.22.0 (web/.nvmrc); this host's node is 20.0.0\n",
  );
});

Deno.test("installs web/'s packages only when they are older than the lock file", async () => {
  const repo = await fixture();
  const fresh = await host(stubs());
  await program(repo, "web", ["format"], { PATH: fresh.path });
  assert.ok(
    !(await fresh.log()).includes("npm ci"),
    "setup: an install newer than the lock",
  );

  const future = new Date(Date.now() + 60_000);
  await Deno.utime(`${repo}/web/package-lock.json`, future, future);
  const stale = await host(stubs());
  await program(repo, "web", ["format"], { PATH: stale.path });
  assert.ok((await stale.log()).includes("npm ci --no-audit --no-fund"));

  await Deno.remove(`${repo}/web/node_modules/.package-lock.json`);
  const absent = await host(stubs());
  await program(repo, "web", ["format"], { PATH: absent.path });
  assert.ok((await absent.log()).includes("npm ci --no-audit --no-fund"));
});

Deno.test("lint counts the files beside their selection and passes the repository's files", async () => {
  const { path, log } = await host(stubs());
  const ran = await program(await fixture(), "web", ["lint"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.includes(
      `linted 1 files with eslint, type rules included, selected by: ${LINT_SCOPE}; type-checked web/tsconfig.json\n`,
    ),
    ran.stdout,
  );
  assert.ok(ran.stdout.includes(
    "found no @vercel/ package and no edge runtime in web/ (git grep --untracked over web/), and the pattern found both control lines\n",
  ));
  assert.ok(ran.stdout.includes(
    "checked that the 2 FROM lines of web/Dockerfile run Node 24.22.0, as web/.nvmrc does\n",
  ));
  const calls = await log();
  assert.ok(calls.includes("npx next typegen\n"));
  assert.ok(calls.includes("npx eslint --max-warnings 0 a.ts\n"));
  assert.ok(calls.includes("npx tsc --noEmit\n"));
  assert.ok(calls.includes("node tools/brand/generate.mjs --check\n"));
});

Deno.test("lint refuses Vercel-only code of each kind, tracked or not, and passes a nodejs runtime", async () => {
  const { path } = await host(stubs());
  const clean = await fixture();
  await write(clean, "web/route.ts", `export const runtime = 'nodejs';\n`);
  assert.equal((await program(clean, "web", ["lint"], { PATH: path })).code, 0);

  for (
    const line of [
      `import { kv } from "@vercel/kv";\n`,
      `export const runtime = "edge";\n`,
    ]
  ) {
    const repo = await fixture();
    await write(repo, "web/route.ts", line);
    const ran = await program(repo, "web", ["lint"], { PATH: path });
    assert.equal(ran.code, 1, line);
    assert.equal(
      ran.stderr,
      "web/ holds Vercel-only code (an @vercel/ package or the edge runtime): docs/architecture/web.md\n",
    );
    assert.ok(ran.stdout.includes("web/route.ts:1:"), ran.stdout);
  }
});

Deno.test("lint refuses a pattern that no longer finds both control lines, and passes one that does", async () => {
  const repo = await fixture();
  const finding = await host(stubs());
  assert.equal(
    (await program(repo, "web", ["lint"], { PATH: finding.path })).code,
    0,
  );

  const missing = await host(stubs({ grep: `echo "one line"` }));
  const ran = await program(repo, "web", ["lint"], { PATH: missing.path });
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /^the portability pattern no longer finds both control lines: /,
  );
});

Deno.test("lint refuses a FROM on another Node release", async () => {
  const { path } = await host(stubs());
  const repo = await fixture();
  await write(
    repo,
    "web/Dockerfile",
    "FROM node:24.22.0-slim\nFROM node:22.0.0-slim\n",
  );
  const ran = await program(repo, "web", ["lint"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "every FROM in web/Dockerfile must be node:24.22.0-..., the release web/.nvmrc names\n",
  );
});

Deno.test("lint fails on a Dockerfile with no FROM", async () => {
  const { path } = await host(stubs());
  const repo = await fixture();
  await write(repo, "web/Dockerfile", "RUN x\n");
  const ran = await program(repo, "web", ["lint"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, "web/Dockerfile has no FROM line\n");
});

Deno.test("format counts its wider selection, leaving out the lock file", async () => {
  const { path, log } = await host(stubs());
  const ran = await program(await fixture(), "web", ["format"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
  assert.match(
    ran.stdout,
    /^format checked 2 files with prettier, selected by: /,
  );
  assert.ok(
    (await log()).includes(
      "npx prettier --check --log-level warn a.ts b.json\n",
    ),
  );
});

Deno.test("fails when no file is selected", async () => {
  const { path } = await host(stubs());
  const repo = await fixture();
  await Deno.remove(`${repo}/web/a.ts`);
  await commit(repo, "none");
  const ran = await program(repo, "web", ["lint"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, `no file was selected by: ${LINT_SCOPE}\n`);
});

Deno.test("builds with app/config/dev.json's values unless the environment set them", async () => {
  const fromConfig = await host(stubs());
  await program(await fixture(), "web", ["build"], { PATH: fromConfig.path });
  assert.ok(
    (await fromConfig.log()).includes(
      "env url=https://config.example key=config-key",
    ),
  );

  const preset = await host(stubs());
  await program(await fixture(), "web", ["build"], {
    PATH: preset.path,
    NEXT_PUBLIC_SUPABASE_URL: "https://preset.example",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "preset-key",
  });
  assert.ok(
    (await preset.log()).includes(
      "env url=https://preset.example key=preset-key",
    ),
  );
});

Deno.test("build builds the image where Docker answers", async () => {
  const { path } = await host(stubs());
  const ran = await program(await fixture(), "web", ["build"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.endsWith(
      "built the image knowno-web:local from web/Dockerfile\n",
    ),
    ran.stdout,
  );
});

Deno.test("build without Docker skips the image, and fails where CI is set", async () => {
  const { path } = await host(without("docker"));
  const repo = await fixture();
  const local = await program(repo, "web", ["build"], { PATH: path });
  assert.equal(local.code, 0, local.stderr);
  assert.ok(
    local.stdout.endsWith(
      "skipped the image build: docker or docker buildx does not answer\n",
    ),
    local.stdout,
  );
  const ci = await program(repo, "web", ["build"], { PATH: path, CI: "true" });
  assert.equal(ci.code, 1);
  assert.match(ci.stderr, /^did not run the image build/);
});

Deno.test("a failed image build prints its whole log", async () => {
  const { path } = await host(stubs({
    docker:
      `case "$1" in build) echo "next build: the failing step"; exit 1 ;; esac`,
  }));
  const ran = await program(await fixture(), "web", ["build"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.ok(ran.stderr.includes("next build: the failing step"), ran.stderr);
  assert.ok(
    ran.stderr.endsWith(
      "the image build from web/Dockerfile failed; its log is above\n",
    ),
  );
});

Deno.test("test runs the specs against the image, as non-root, and stops it", async () => {
  const { path, log } = await host(stubs());
  const ran = await program(await fixture(), "web", ["test"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.includes(
      "the image knowno-web:local answers http://127.0.0.1:5000/api/health and runs as uid 1000\n",
    ),
    ran.stdout,
  );
  const calls = await log();
  assert.ok(
    calls.includes(
      "npx playwright test\nenv url=https://config.example key=config-key e2e=http://127.0.0.1:5000\n",
    ),
    calls,
  );
  // The service's origin names the port the image is published on, at localhost.
  assert.match(
    calls,
    /^docker run --detach --rm --publish 127\.0\.0\.1:(\d+):3000 --env KNOWNO_SERVICE_ORIGIN=http:\/\/localhost:\1 knowno-web:local$/m,
  );
  assert.ok(calls.includes("docker stop the-container\n"), calls);
});

Deno.test("test refuses an image running as root, and stops it", async () => {
  const { path, log } = await host(stubs());
  const ran = await program(await fixture(), "web", ["test"], {
    PATH: path,
    IMAGE_UID: "0",
  });
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, "the image runs as root\n");
  const calls = await log();
  assert.ok(!calls.includes("npx playwright test"), calls);
  assert.ok(calls.includes("docker stop the-container\n"), calls);
});

Deno.test("test without Docker skips the specs, and fails where CI is set", async () => {
  const { path } = await host(without("docker"));
  const repo = await fixture();
  const local = await program(repo, "web", ["test"], { PATH: path });
  assert.equal(local.code, 0, local.stderr);
  assert.ok(
    local.stdout.startsWith("ran the tests vitest selects in web/"),
    local.stdout,
  );
  assert.ok(
    local.stdout.endsWith(
      "skipped the e2e specs in web/e2e/: they run against the image, and docker or docker buildx does not answer\n",
    ),
    local.stdout,
  );
  const ci = await program(repo, "web", ["test"], { PATH: path, CI: "true" });
  assert.equal(ci.code, 1);
});

Deno.test("refuses an unknown task with exit 2", async () => {
  const { path } = await host(stubs());
  const ran = await program(await fixture(), "web", ["nothing"], {
    PATH: path,
  });
  assert.equal(ran.code, 2);
  assert.equal(
    ran.stderr,
    "usage: scripts/run.sh web lint|format|test|build\n",
  );
});

Deno.test("fromLines counts each FROM and those on the release", () => {
  const file =
    "FROM node:24.22.0-a\nFROM node:24.22.01-a\nRUN FROM node:1\nFROM debian\n";
  assert.deepEqual(fromLines(file, "24.22.0"), { total: 3, onRelease: 1 });
});

Deno.test("answersWithin stops at the first answer, and gives up after its tries", async () => {
  let asked = 0;
  const onThird = () => Promise.resolve(++asked === 3);
  assert.equal(await answersWithin(onThird, 60, 0), true);
  assert.equal(asked, 3);

  asked = 0;
  const never = () => {
    asked++;
    return Promise.resolve(false);
  };
  assert.equal(await answersWithin(never, 5, 0), false);
  assert.equal(asked, 6);
});
