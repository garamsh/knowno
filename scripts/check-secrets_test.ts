// scripts/check-secrets.ts. Keys are put together here and never written out, so this file passes
// the check it tests.
import assert from "node:assert/strict";
import { isBinary, jwtRole } from "./check-secrets.ts";
import { commit, git, program, repository, run, write } from "./testing.ts";

const secretKey = () => "sb_" + "secret_" + "abcd1234EFGH";
const encoded = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const jwt = (payload: string) =>
  `${encoded('{"alg":"HS256"}')}.${encoded(payload)}.c2lnbmF0dXJl`;
const serviceRole = () => jwt('{"role":"service_role"}');
const anon = () => jwt('{"role":"anon"}');

const SECRET_MESSAGE = "holds a Supabase secret key (sb_secret_...)";
const ROLE_MESSAGE =
  "holds a Supabase service-role key (a JWT with role service_role)";

/** Asserts the whole output carries none of the keys; the check prints only a file. */
function assertNoKey(output: string, ...keys: string[]): void {
  for (const key of keys) {
    assert.ok(!output.includes(key), "the check printed a key");
  }
}

Deno.test("reports a secret key by its file, never the key, and passes without it", async () => {
  const repo = await repository();
  await write(repo, "clean.txt", "no key here\n");
  await commit(repo, "clean");
  assert.equal((await program(repo, "check-secrets")).code, 0);

  const key = secretKey();
  await write(repo, "leak.txt", `key=${key}\n`);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 1);
  assert.ok(ran.stdout.includes(`leak.txt: ${SECRET_MESSAGE}\n`), ran.stdout);
  assertNoKey(ran.stdout + ran.stderr, key, key.slice(3));
});

Deno.test("reports a service-role JWT by its file, never the key, and passes an anon one", async () => {
  const repo = await repository();
  await write(repo, "anon.txt", `${anon()}\n`);
  const passing = await program(repo, "check-secrets");
  assert.equal(passing.code, 0, passing.stdout);

  const key = serviceRole();
  await write(repo, "role.txt", `token: ${key}\n`);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 1);
  assert.ok(ran.stdout.includes(`role.txt: ${ROLE_MESSAGE}\n`), ran.stdout);
  assert.ok(!ran.stdout.includes("anon.txt"), ran.stdout);
  assertNoKey(ran.stdout + ran.stderr, key, key.split(".")[1]);
});

Deno.test("a payload that does not parse prints none of itself and hides no later key", async () => {
  const repo = await repository();
  const broken = jwt('{"role":"service_role", not json');
  const key = serviceRole();
  await write(repo, "mixed.txt", `${broken}\n${key}\n`);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 1);
  assert.ok(ran.stdout.includes(`mixed.txt: ${ROLE_MESSAGE}\n`), ran.stdout);
  assertNoKey(ran.stdout + ran.stderr, broken, broken.split(".")[1], key);
});

Deno.test("an unreadable payload alone passes", async () => {
  const repo = await repository();
  await write(repo, "broken.txt", `${jwt("not json at all")}\n`);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 0, ran.stderr);
});

Deno.test("reads an untracked file and leaves an ignored one out of the check and the count", async () => {
  const repo = await repository();
  await write(repo, ".gitignore", "ignored.txt\n");
  await commit(repo, "ignore");
  const before = await program(repo, "check-secrets");
  const count = Number(before.stdout.match(/^checked (\d+) files/)?.[1]);
  assert.ok(count > 0, before.stdout);

  await write(repo, "ignored.txt", `${secretKey()}\n`);
  const ignored = await program(repo, "check-secrets");
  assert.equal(ignored.code, 0, ignored.stdout);
  assert.ok(ignored.stdout.includes(`checked ${count} files`), ignored.stdout);

  await write(repo, "untracked.txt", `${secretKey()}\n`);
  const untracked = await program(repo, "check-secrets");
  assert.equal(untracked.code, 1);
  assert.ok(
    untracked.stdout.includes(`checked ${count + 1} files`),
    untracked.stdout,
  );
  assert.ok(untracked.stdout.includes(`untracked.txt: ${SECRET_MESSAGE}`));
});

Deno.test("skips the content of a binary file as grep -I does, and counts it", async () => {
  const repo = await repository();
  await commit(repo, "scripts");
  const before = await program(repo, "check-secrets");
  const count = Number(before.stdout.match(/^checked (\d+) files/)?.[1]);

  const content = new TextEncoder().encode(`\0${secretKey()}\n`);
  await write(repo, "image.bin", content);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 0, ran.stdout);
  assert.ok(ran.stdout.includes(`checked ${count + 1} files`), ran.stdout);
});

Deno.test("does not count a symlink to a directory or a tracked file that was deleted", async () => {
  const repo = await repository();
  await write(repo, "dir/kept.txt", "kept\n");
  await write(repo, "gone.txt", "gone\n");
  await run(repo, ["ln", "-s", "dir", "link"]);
  await commit(repo, "files");
  const before = await program(repo, "check-secrets");
  const count = Number(before.stdout.match(/^checked (\d+) files/)?.[1]);

  await Deno.remove(`${repo}/gone.txt`);
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(ran.stdout.includes(`checked ${count - 1} files`), ran.stdout);
  assert.ok(
    (await git(repo, "ls-files", "link")) === "link",
    "setup: link is tracked",
  );
});

Deno.test("fails when no file was read", async () => {
  const repo = await repository();
  await Deno.writeTextFile(`${repo}/.git/info/exclude`, "*\n");
  const ran = await program(repo, "check-secrets");
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stdout,
    "checked 0 files for Supabase secret and service-role keys, selected by: git ls-files --cached --others --exclude-standard\n",
  );
  assert.equal(ran.stderr, "no file was read\n");
});

Deno.test("jwtRole reads a payload's role and nothing from one that does not decode", () => {
  assert.equal(jwtRole(serviceRole()), "service_role");
  assert.equal(jwtRole(jwt("[1]")), undefined);
  assert.equal(jwtRole(jwt("null")), undefined);
  assert.equal(jwtRole("eyJh.eyJhA.c"), undefined);
});

Deno.test("isBinary is the NUL byte", () => {
  assert.equal(isBinary(new Uint8Array([97, 0])), true);
  assert.equal(isBinary(new Uint8Array([97, 200])), false);
});
