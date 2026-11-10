// scripts/check-functions-declared.ts on repositories built in a temporary directory. Each refusal
// is read beside the matched layout it is made from.
import assert from "node:assert/strict";
import { declaredIn, missingFrom } from "./check-functions-declared.ts";
import { outputLines, program, Ran, repository, write } from "./testing.ts";

const CONFIG = "supabase/config.toml";

async function layout(
  disk: string[],
  declared: string[],
  extra: Record<string, string> = {},
): Promise<Ran> {
  const repo = await repository();
  for (const name of disk) {
    await write(repo, `supabase/functions/${name}/index.ts`, "");
  }
  const entries = declared.map((name) =>
    `[functions.${name}]\nverify_jwt = true\n`
  );
  await write(repo, CONFIG, entries.join("\n"));
  for (const [path, content] of Object.entries(extra)) {
    await write(repo, path, content);
  }
  return await program(repo, "check-functions-declared");
}

Deno.test("accepts functions on disk that config.toml declares, _shared and a directory with no index.ts apart", async () => {
  const ran = await layout(["a", "b-c"], ["a", "b-c"], {
    "supabase/functions/_shared/index.ts": "",
    "supabase/functions/notes/readme.md": "",
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout.trim(),
    `checked 2 functions in supabase/functions/, every directory there but _shared holding an index.ts, against the [functions.<name>] entries of ${CONFIG}: each is declared`,
  );
});

Deno.test("refuses a function on disk with no entry, naming it, and not the declared one", async () => {
  const ran = await layout(["a", "b"], ["a"]);
  assert.equal(ran.code, 1);
  const lines = outputLines(ran);
  assert.ok(
    lines.includes(
      `supabase/functions/b has no [functions.b] entry in ${CONFIG}, so a merge never deploys it`,
    ),
    ran.stderr,
  );
  assert.ok(!lines.some((line) => line.includes("functions/a ")), ran.stderr);
});

Deno.test("refuses an entry naming no function directory, naming it, and not the one that has one", async () => {
  const ran = await layout(["a"], ["a", "gone"]);
  assert.equal(ran.code, 1);
  const lines = outputLines(ran);
  assert.ok(
    lines.includes(
      `[functions.gone] in ${CONFIG} names no directory supabase/functions/gone holding an index.ts`,
    ),
    ran.stderr,
  );
  assert.ok(!lines.some((line) => line.includes("[functions.a]")), ran.stderr);
});

Deno.test("refuses an entry whose directory holds no index.ts", async () => {
  const ran = await layout(["a"], ["a", "b"], {
    "supabase/functions/b/helper.ts": "",
  });
  assert.equal(ran.code, 1);
  assert.ok(
    outputLines(ran).some((line) => line.startsWith("[functions.b] in")),
    ran.stderr,
  );
});

Deno.test("fails when no directory holds an index.ts, as it counts nothing", async () => {
  const ran = await layout([], []);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /^found no function in supabase\/functions\//);
});

Deno.test("declaredIn reads the table names and not a comment or a key", () => {
  assert.deepEqual(
    declaredIn(
      "# [functions.old]\n[functions.a]\nverify_jwt = true\n[functions.b-c]\n[auth]\n",
    ),
    ["a", "b-c"],
  );
});

Deno.test("missingFrom keeps what the other list lacks", () => {
  assert.deepEqual(missingFrom(["a", "b"], ["b"]), ["a"]);
});
