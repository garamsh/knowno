// scripts/deno.ts on a repository holding one test of each set.
import assert from "node:assert/strict";
import { passedCount } from "./deno.ts";
import { program, repository, write } from "./testing.ts";

const PASSES = `Deno.test("passes", () => {});\n`;
const FAILS = `Deno.test("fails", () => { throw new Error("no"); });\n`;

async function fixture(evalTest: string): Promise<string> {
  const repo = await repository();
  await write(repo, "tools/eval/a_test.ts", evalTest);
  await write(repo, "scripts/a_test.ts", PASSES);
  return repo;
}

Deno.test("test counts each set beside how it was selected, and fails on a failing test", async () => {
  const passing = await program(await fixture(PASSES), "deno", ["test"]);
  assert.equal(passing.code, 0, passing.stdout + passing.stderr);
  assert.ok(
    passing.stdout.includes(
      "ran 1 Deno tests in 1 files, selected as the *_test.ts files among: git ls-files --cached --others --exclude-standard -- 'supabase/functions/*.ts' 'tools/eval/*.ts' 'tools/fonts/*.ts'\n",
    ),
    passing.stdout,
  );
  assert.ok(
    passing.stdout.includes(
      "ran 1 Deno tests in 1 files of scripts/, selected as the *_test.ts files among: git ls-files --cached --others --exclude-standard -- 'scripts/*.ts'\n",
    ),
    passing.stdout,
  );

  const failing = await program(await fixture(FAILS), "deno", ["test"]);
  assert.equal(failing.code, 1);
  assert.ok(failing.stdout.includes("FAILED"), failing.stdout);
  assert.ok(!failing.stdout.includes("Deno tests"), failing.stdout);
  assert.ok(!failing.stderr.includes("ran no test"), failing.stderr);
});

Deno.test("test fails when a test file ran no test", async () => {
  const ran = await program(await fixture("export {};\n"), "deno", ["test"]);
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr.trim().split("\n").at(-1), "deno test ran no test");
});

Deno.test("fails when no file is selected, naming the selection", async () => {
  const ran = await program(await repository(), "deno", ["format"]);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /^no TypeScript file was selected by: git ls-files/);
});

Deno.test("refuses an unknown task with exit 2", async () => {
  const ran = await program(await fixture(PASSES), "deno", ["nothing"]);
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /^usage: /);
});

Deno.test("passedCount takes the last summary and reads none as zero", () => {
  assert.equal(
    passedCount("ok | 3 passed | 0 failed\nok | 12 passed (1s)"),
    12,
  );
  assert.equal(passedCount("nothing ran"), 0);
});

Deno.test("test runs a tools/fonts/ test apart, under a grant that lets it run python3, and counts it", async () => {
  const repo = await fixture(PASSES);
  await write(
    repo,
    "tools/fonts/a_test.ts",
    `Deno.test("runs python3", async () => {
  const { code } = await new Deno.Command("python3", { args: ["-c", "pass"] }).output();
  if (code !== 0) throw new Error("python3 failed");
});\n`,
  );
  const ran = await program(repo, "deno", ["test"]);
  assert.equal(ran.code, 0, ran.stdout + ran.stderr);
  assert.ok(ran.stdout.includes("runs python3 ... ok"), ran.stdout);
  assert.ok(
    ran.stdout.includes(
      "ran 2 Deno tests in 2 files, selected as the *_test.ts files among: git ls-files --cached --others --exclude-standard -- 'supabase/functions/*.ts' 'tools/eval/*.ts' 'tools/fonts/*.ts'\n",
    ),
    ran.stdout,
  );
});
