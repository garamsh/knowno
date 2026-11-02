// skip.sh and skip.ts: without CI a step is skipped, says so and the program carries on; with CI
// set the same call fails it, so CI never reports a skipped step as a passed one.
import assert from "node:assert/strict";
import { program, repository, run, write } from "./testing.ts";

const SKIPPED = "skipped the probe: this host has no probe command";
const REFUSED =
  "did not run the probe: this host has no probe command; CI is set, and there a missing tool fails the step instead of skipping it";

const shell = [
  "sh",
  "-c",
  ". scripts/skip.sh; skip 'the probe: this host has no probe command'; echo carried on",
];

async function denoProbe(repo: string): Promise<string[]> {
  await write(
    repo,
    "scripts/probe.ts",
    `import { entry } from "./process.ts";
import { skip } from "./skip.ts";
await entry(() => {
  skip("the probe: this host has no probe command");
  console.log("carried on");
  return Promise.resolve();
});
`,
  );
  return ["deno", "run", "--no-prompt", "--allow-env=CI", "scripts/probe.ts"];
}

Deno.test("skip.sh without CI skips the step and the script carries on", async () => {
  const ran = await run(await repository(), shell);
  assert.equal(ran.code, 0);
  assert.equal(ran.stdout, `${SKIPPED}\ncarried on\n`);
});

Deno.test("skip.sh with CI set fails the script", async () => {
  const ran = await run(await repository(), shell, { CI: "true" });
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout, "");
  assert.equal(ran.stderr, `${REFUSED}\n`);
});

Deno.test("skip.ts without CI skips the step and the program carries on", async () => {
  const repo = await repository();
  const ran = await run(repo, await denoProbe(repo));
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, `${SKIPPED}\ncarried on\n`);
});

Deno.test("skip.ts with CI set fails the program", async () => {
  const repo = await repository();
  const ran = await run(repo, await denoProbe(repo), { CI: "true" });
  assert.equal(ran.code, 1);
  assert.equal(ran.stdout, "");
  assert.equal(ran.stderr, `${REFUSED}\n`);
});

Deno.test("run.sh skips a program on a host with no deno, and fails where CI is set", async () => {
  const repo = await repository();
  const noDeno = { PATH: "/usr/bin:/bin" };
  const present = await run(repo, ["sh", "-c", "command -v deno"], noDeno);
  assert.notEqual(present.code, 0, `setup: found deno at ${present.stdout}`);

  const local = await program(repo, "check-secrets", [], noDeno);
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped scripts/check-secrets.ts: this host has no deno command\n",
  );

  const ci = await program(repo, "check-secrets", [], {
    ...noDeno,
    CI: "true",
  });
  assert.equal(ci.code, 1);
  assert.match(
    ci.stderr,
    /^did not run scripts\/check-secrets\.ts: this host/,
  );
});

Deno.test("run.sh refuses a program it holds no grant for", async () => {
  const ran = await program(await repository(), "no-such-program");
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /no program is named no-such-program/);
});
