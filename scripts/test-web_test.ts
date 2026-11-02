// scripts/test-web.ts against stubs of Docker, the Supabase CLI, npx, node and curl. The node stub
// serves until it is stopped, or exits with EADDRINUSE once where the test leaves a mark for it; the
// curl stub answers once the server is up.
import assert from "node:assert/strict";
import { playwrightSummary, specsThatPassed } from "./test-web.ts";
import { DOCKER, reservationsLeft, SUPABASE } from "./stacks_testing.ts";
import { commit, host, program, RECORD, repository, write } from "./testing.ts";

const NODE = `${RECORD}
here="$(dirname "$0")"
if [ -f "$here/taken" ]; then rm "$here/taken"; echo "Error: listen EADDRINUSE: 127.0.0.1:$PORT" >&2; exit 1; fi
touch "$here/up"; exec sleep 30`;
const CURL = `[ -f "$(dirname "$0")/up" ]`;
const PASSED =
  "  ✓  1 [chromium] › e2e/a.spec.ts:3:1 › works\n  ✓  2 [chromium] › e2e/b.spec.ts:3:1 › works\n\n  2 passed (1s)";
const NPX = `${RECORD}
[ "$1 $2" != "playwright test" ] || { printf '%s\\n' "\${PLAYWRIGHT:-${PASSED}}"; exit "\${PLAYWRIGHT_EXIT:-0}"; }`;
const stubs = () => ({
  docker: DOCKER,
  supabase: SUPABASE,
  npx: NPX,
  node: NODE,
  curl: CURL,
});

async function fixture(): Promise<string> {
  const repo = await repository();
  for (const spec of ["a", "b"]) {
    await write(repo, `web/e2e/${spec}.spec.ts`, "test\n");
  }
  await commit(repo, "specs");
  for (
    const dir of [
      "web/.next/static",
      "web/public",
      "web/.next/standalone/.next",
    ]
  ) {
    await Deno.mkdir(`${repo}/${dir}`, { recursive: true });
  }
  return repo;
}

const SCOPE =
  "git ls-files --cached --others --exclude-standard -- 'web/e2e/*.spec.ts'";

Deno.test("runs every spec against the app built for its stack, then stops the server and the stack", async () => {
  const { path, log } = await host(stubs());
  const tmp = await Deno.makeTempDir();
  const ran = await program(await fixture(), "test-web", [], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(ran.code, 0, ran.stderr);
  const id = (await log()).match(/^env (knowno_web_\d+) /m)?.[1];
  assert.match(ran.stdout, /^the web app answers on port 546\d\d$/m);
  assert.ok(
    ran.stdout.endsWith(
      `ran 2 web e2e tests in 2 specs against the web app built for the stack ${id}, selected by: ${SCOPE}\n`,
    ),
    ran.stdout,
  );
  const calls = await log();
  assert.ok(
    calls.includes("npx next build\n") &&
      calls.includes("node web/.next/standalone/server.js\n"),
    calls,
  );
  assert.ok(calls.trimEnd().endsWith("supabase stop --no-backup"), calls);
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("tries the next port when the server finds its port taken", async () => {
  const { path } = await host(stubs());
  await Deno.writeTextFile(`${path}/taken`, "");
  const ran = await program(await fixture(), "test-web", [], {
    PATH: path,
    TMPDIR: await Deno.makeTempDir(),
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.match(
    ran.stdout,
    /^port (546\d\d) was taken after it was reserved; trying the next free port\nthe web app answers on port 546\d\d$/m,
  );
});

Deno.test("fails when a spec ran no test, or a test skipped", async () => {
  const { path } = await host(stubs());
  const missed = await program(await fixture(), "test-web", [], {
    PATH: path,
    TMPDIR: await Deno.makeTempDir(),
    PLAYWRIGHT:
      "  ✓  1 [chromium] › e2e/a.spec.ts:3:1 › works\n\n  1 passed (1s)",
  });
  assert.equal(missed.code, 1);
  assert.match(
    missed.stderr,
    /^these e2e specs ran no test against the stack knowno_web_\d+:\ne2e\/b\.spec\.ts\n$/,
  );

  const skipping = await host(stubs());
  const skipped = await program(await fixture(), "test-web", [], {
    PATH: skipping.path,
    TMPDIR: await Deno.makeTempDir(),
    PLAYWRIGHT: `${PASSED}\n  1 skipped`,
  });
  assert.equal(skipped.code, 1);
  assert.match(
    skipped.stderr,
    /^the web e2e specs skipped or ran no test against the stack knowno_web_\d+\n$/,
  );
});

Deno.test("a failing run prints the specs' output and the app's log", async () => {
  const { path } = await host(stubs());
  const ran = await program(await fixture(), "test-web", [], {
    PATH: path,
    TMPDIR: await Deno.makeTempDir(),
    PLAYWRIGHT: "  1 failed",
    PLAYWRIGHT_EXIT: "1",
  });
  assert.equal(ran.code, 1);
  assert.ok(
    ran.stdout.includes("  1 failed\nthe web app's log:\n"),
    ran.stdout,
  );
});

Deno.test("fails with no spec selected, and skips without node, Deno's own node not counting", async () => {
  const { path } = await host(stubs());
  const empty = await program(await repository(), "test-web", [], {
    PATH: path,
    TMPDIR: await Deno.makeTempDir(),
  });
  assert.equal(empty.code, 1);
  assert.equal(empty.stderr, `no e2e spec was selected by: ${SCOPE}\n`);

  const noNode: Record<string, string> = stubs();
  delete noNode.node;
  const bare = await host(noNode);
  const ran = await program(await fixture(), "test-web", [], {
    PATH: bare.path,
    TMPDIR: await Deno.makeTempDir(),
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout,
    "skipped the web e2e specs in web/e2e/: this host has no node command\n",
  );
});

Deno.test("playwrightSummary and specsThatPassed read the list reporter", () => {
  assert.deepEqual(playwrightSummary(`${PASSED}\n`), {
    passed: 2,
    skipped: false,
  });
  assert.deepEqual(playwrightSummary("  3 passed\n  1 skipped\n"), {
    passed: 3,
    skipped: true,
  });
  assert.deepEqual([...specsThatPassed(PASSED)], [
    "e2e/a.spec.ts",
    "e2e/b.spec.ts",
  ]);
  assert.deepEqual([
    ...specsThatPassed("  ✘  1 [chromium] › e2e/c.spec.ts:1:1 › fails"),
  ], []);
});
