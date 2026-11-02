// scripts/check-migration-order.ts on repositories built in a temporary directory: a pull request's
// merge commit as CI checks it out (a clone two commits deep), and a branch beside origin/main as a
// contributor runs it. Each refusal is read beside the case it accepts.
import assert from "node:assert/strict";
import { notAfter, versionsOf } from "./check-migration-order.ts";
import {
  commit,
  git,
  outputLines,
  program,
  Ran,
  repository,
  write,
} from "./testing.ts";

const ON_MAIN = ["20261017120000_a.sql", "20261018090000_b.sql"];
const DIR = "supabase/migrations";

async function addMigrations(repo: string, names: string[]): Promise<void> {
  for (const name of names) await write(repo, `${DIR}/${name}`, "select 1;\n");
}

async function mainWith(names: string[]): Promise<string> {
  const repo = await repository();
  await addMigrations(repo, names);
  await commit(repo, "main");
  return repo;
}

async function branchAdds(repo: string, names: string[]): Promise<void> {
  await git(repo, "checkout", "-q", "-b", "branch", "main");
  await addMigrations(repo, names);
  await commit(repo, "branch");
}

/** The check in a clone two commits deep at a merge of the branch into main. */
async function asCi(repo: string): Promise<Ran> {
  await git(repo, "checkout", "-q", "main");
  await git(repo, "merge", "-q", "--no-ff", "-m", "merge", "branch");
  const clone = await Deno.makeTempDir();
  await git(clone, "clone", "-q", "--depth", "2", `file://${repo}`, ".");
  await git(clone, "rev-parse", "-q", "--verify", "HEAD^2");
  await git(clone, "remote", "remove", "origin");
  return await program(clone, "check-migration-order");
}

/** The check on the branch, beside an origin/main at main. */
async function asContributor(repo: string): Promise<Ran> {
  await git(repo, "update-ref", "refs/remotes/origin/main", "main");
  return await program(repo, "check-migration-order");
}

const checked = (count: number, base: string, how: string) =>
  `checked ${count} new migrations in ${DIR}/, every file there that main lacks, against 20261018090000, the latest of 2 on main at ${base} (${how}): each sorts after it`;

const MERGE = "the first parent of the merge commit HEAD";
const LEFT = "where HEAD left origin/main";

Deno.test("accepts a migration one second after main's latest, ahead of the clock as it is", async () => {
  const repo = await mainWith(ON_MAIN);
  await branchAdds(repo, ["20261018090001_next.sql"]);
  const ran = await asCi(repo);
  assert.equal(ran.code, 0, ran.stderr);
  assert.deepEqual(
    ran.stdout.trim(),
    checked(1, await git(repo, "rev-parse", "main~1"), MERGE),
  );
});

Deno.test("refuses a migration named before main's latest and not the one named after it", async () => {
  const repo = await mainWith(ON_MAIN);
  await branchAdds(repo, [
    "20261018090001_next.sql",
    "20261017200000_early.sql",
  ]);
  const ran = await asCi(repo);
  assert.equal(ran.code, 1);
  const lines = outputLines(ran);
  assert.ok(lines.includes("20261017200000"), ran.stderr);
  assert.ok(!lines.includes("20261018090001"), ran.stderr);
  assert.ok(lines.includes("name each after the latest on main (server.md)"));
});

Deno.test("refuses a migration of main's latest version under another name", async () => {
  const repo = await mainWith(ON_MAIN);
  await branchAdds(repo, ["20261018090000_same.sql"]);
  const ran = await asCi(repo);
  assert.equal(ran.code, 1);
  assert.ok(outputLines(ran).includes("20261018090000"), ran.stderr);
});

Deno.test("reads a migration main has since passed against the branch's base, and the merge against main", async () => {
  const repo = await mainWith(ON_MAIN);
  await branchAdds(repo, ["20261018090001_next.sql"]);
  await git(repo, "checkout", "-q", "main");
  await addMigrations(repo, ["20261018090002_merged.sql"]);
  await commit(repo, "main moves");
  const base = await git(repo, "rev-parse", "main~1");

  await git(repo, "checkout", "-q", "branch");
  const contributor = await asContributor(repo);
  assert.equal(contributor.code, 0, contributor.stderr);
  assert.equal(contributor.stdout.trim(), checked(1, base, LEFT));

  const ci = await asCi(repo);
  assert.equal(ci.code, 1);
  assert.ok(outputLines(ci).includes("20261018090001"), ci.stderr);
});

Deno.test("refuses a migration whose name does not start with 14 digits", async () => {
  const repo = await mainWith(ON_MAIN);
  await branchAdds(repo, ["20261018_short.sql"]);
  const ran = await asCi(repo);
  assert.equal(ran.code, 1);
  assert.ok(
    outputLines(ran).includes(
      "20261018_short.sql is not named <14-digit UTC time>_<name>.sql",
    ),
    ran.stderr,
  );
});

Deno.test("accepts main itself, after a merge, with nothing new", async () => {
  const repo = await mainWith(ON_MAIN);
  const ran = await asContributor(repo);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout.trim(),
    checked(0, await git(repo, "rev-parse", "main"), LEFT),
  );
});

Deno.test("fails with no base: no merge commit and no origin/main", async () => {
  const repo = await mainWith(ON_MAIN);
  const ran = await program(repo, "check-migration-order");
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /^found no base to compare supabase\/migrations\/ with/,
  );
});

Deno.test("versionsOf stops at the first name of another shape", () => {
  assert.deepEqual(
    versionsOf(["20261018090000_a.sql", "x.sql", "20261018090001_b.sql"]),
    {
      versions: ["20261018090000"],
      refused: "x.sql",
    },
  );
});

Deno.test("notAfter keeps a version equal to the latest and drops a later one", () => {
  assert.deepEqual(notAfter(["1", "2", "3"], "2"), ["1", "2"]);
});
