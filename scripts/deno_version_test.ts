// scripts/run.sh deno-version check: a stub deno that echoes its version fails when it differs from
// scripts/.deno-version, and passes when it matches.
import assert from "node:assert/strict";
import { host, program, repository, write } from "./testing.ts";

const VERSION = "2.9.7";

const STUB_MATCH = `if [ "$1" = --version ]; then echo deno ${VERSION} (release, linux x86_64); exit; fi`;

const STUB_DIFFER = `if [ "$1" = --version ]; then echo deno 2.4.5 (release, linux x86_64); exit; fi`;

const GRANT_LINE = `deno: --allow-read=scripts --allow-write=/tmp --allow-run=env --allow-net=127.0.0.1`;

Deno.test("deno version check passes when host matches scripts/.deno-version", async () => {
  const { path } = await host({ deno: STUB_MATCH });
  const repo = await repository();
  await write(repo, "scripts/.deno-version", `${VERSION}\n`);
  await write(repo, "scripts/grants.txt", `${GRANT_LINE}\n`);
  await write(repo, "scripts/echo_test.ts", `Deno.test("ok", () => {});\n`);
  const ran = await program(repo, "deno", ["test"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
});

Deno.test("deno version check fails on a different version, naming both", async () => {
  const { path } = await host({ deno: STUB_DIFFER });
  const repo = await repository();
  await write(repo, "scripts/.deno-version", `${VERSION}\n`);
  await write(repo, "scripts/grants.txt", `${GRANT_LINE}\n`);
  await write(repo, "scripts/echo_test.ts", `Deno.test("ok", () => {});\n`);
  const ran = await program(repo, "deno", ["test"], { PATH: path });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    `scripts/run.sh runs on Deno ${VERSION} (scripts/.deno-version); this host's deno is 2.4.5\n`,
  );
});

Deno.test("deno version check fails on a different version where CI is set", async () => {
  const { path } = await host({ deno: STUB_DIFFER });
  const repo = await repository();
  await write(repo, "scripts/.deno-version", `${VERSION}\n`);
  await write(repo, "scripts/grants.txt", `${GRANT_LINE}\n`);
  await write(repo, "scripts/echo_test.ts", `Deno.test("ok", () => {});\n`);
  const ci = await program(
    repo,
    "deno",
    ["test"],
    { PATH: path, CI: "true" },
  );
  assert.equal(ci.code, 1);
  assert.equal(
    ci.stderr,
    `scripts/run.sh runs on Deno ${VERSION} (scripts/.deno-version); this host's deno is 2.4.5\n`,
  );
});

Deno.test("without deno it skips before the version check, as before", async () => {
  const { path } = await host({});
  const repo = await repository();
  await write(repo, "scripts/.deno-version", `${VERSION}\n`);
  await write(repo, "scripts/grants.txt", `${GRANT_LINE}\n`);
  const ran = await program(repo, "deno", ["test"], { PATH: path });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.includes(
      `skipped scripts/deno.ts test: this host has no deno command`,
    ),
    ran.stdout,
  );
});
