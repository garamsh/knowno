// scripts/test-db.ts against stubs of Docker and the Supabase CLI, each run under a temporary
// directory of its own, so its port reservations are its own.
import assert from "node:assert/strict";
import { pgTapCounts } from "./test-db.ts";
import { DOCKER, reservationsLeft, SUPABASE } from "./stacks_testing.ts";
import { host, program, repository, write } from "./testing.ts";

async function fixture(): Promise<{ repo: string; tmp: string }> {
  const repo = await repository();
  await write(repo, "supabase/card-frame-dry-run.sql", "select 1;\n\n");
  await write(repo, "supabase/fixtures/card-frame/conversion.json", "[1]\n");
  return { repo, tmp: await Deno.makeTempDir() };
}

Deno.test("runs the pgTAP tests on a stack of its own, counts them, then stops it and frees its port", async () => {
  const { repo, tmp } = await fixture();
  const { path, log } = await host({ docker: DOCKER, supabase: SUPABASE });
  const ran = await program(repo, "test-db", [], { PATH: path, TMPDIR: tmp });
  assert.equal(ran.code, 0, ran.stderr);
  const port = (await log()).match(/^env knowno_test_(\d+) (\d+) $/m);
  assert.ok(port !== null && port[1] === port[2], await log());
  assert.ok(
    ran.stdout.endsWith(
      `ran 7 pgTAP tests in 2 files against the stack knowno_test_${
        port[1]
      }, selected by supabase test db: every file under supabase/tests/\n`,
    ),
    ran.stdout,
  );
  const calls = await log();
  assert.ok(
    calls.includes(
      "supabase start --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor\n",
    ),
  );
  assert.ok(calls.includes(`-v query=select 1; -v fixtures=[1]\n`), calls);
  assert.ok(
    calls.includes(
      "alter database postgres set knowno.card_frame_dry_run = :'query';\n",
    ),
  );
  assert.ok(calls.trimEnd().endsWith("supabase stop --no-backup"), calls);
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("skips a port something listens on and one another run reserved", async () => {
  const { repo, tmp } = await fixture();
  await Deno.mkdir(`${tmp}/knowno-test-db/54401`, { recursive: true });
  let listener: Deno.Listener | undefined;
  try {
    listener = Deno.listen({ hostname: "127.0.0.1", port: 54400 });
  } catch {
    // Something on this host listens on 54400 already, which serves the test as well.
  }
  try {
    const { path, log } = await host({ docker: DOCKER, supabase: SUPABASE });
    const ran = await program(repo, "test-db", [], { PATH: path, TMPDIR: tmp });
    assert.equal(ran.code, 0, ran.stderr);
    const port = Number((await log()).match(/^env knowno_test_(\d+)/m)?.[1]);
    assert.ok(port > 54401 && port <= 54499, `took ${port}`);
    assert.deepEqual(await reservationsLeft(tmp), ["54401"]);
  } finally {
    listener?.close();
  }
});

Deno.test("fails on a run with no pgTAP test, and on a failing run, stopping the stack each time", async () => {
  const { repo, tmp } = await fixture();
  const empty = await host({ docker: DOCKER, supabase: SUPABASE });
  const none = await program(repo, "test-db", [], {
    PATH: empty.path,
    TMPDIR: tmp,
    PGTAP: "Files=0, Tests=0,",
  });
  assert.equal(none.code, 1);
  assert.equal(none.stderr, "supabase test db ran no pgTAP test\n");
  assert.ok((await empty.log()).includes("supabase stop --no-backup"));

  const broken = await host({ docker: DOCKER, supabase: SUPABASE });
  const failed = await program(repo, "test-db", [], {
    PATH: broken.path,
    TMPDIR: tmp,
    PGTAP: "not ok 1 - the probe",
    PGTAP_EXIT: "3",
  });
  assert.equal(failed.code, 1);
  assert.ok(failed.stdout.includes("not ok 1 - the probe"), failed.stdout);
  assert.equal(failed.stderr, "");
  assert.ok((await broken.log()).includes("supabase stop --no-backup"));
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("a failing psql ends the run with its exit code, stopping the stack", async () => {
  const { repo, tmp } = await fixture();
  const { path, log } = await host({ docker: DOCKER, supabase: SUPABASE });
  const ran = await program(repo, "test-db", [], {
    PATH: path,
    TMPDIR: tmp,
    DOCKER_EXEC_EXIT: "3",
  });
  assert.equal(ran.code, 3);
  const calls = await log();
  assert.ok(!calls.includes("supabase test db"), calls);
  assert.ok(calls.includes("supabase stop --no-backup"), calls);
});

Deno.test("retries a stop Docker refuses, and fails the run once it gives up, freeing its port", async () => {
  const { repo, tmp } = await fixture();
  const twice = await host({ docker: DOCKER, supabase: SUPABASE });
  const retried = await program(repo, "test-db", [], {
    PATH: twice.path,
    TMPDIR: tmp,
    STOP_FAILS: "2",
  });
  assert.equal(retried.code, 0, retried.stderr);
  assert.equal((await twice.log()).match(/^supabase stop/gm)?.length, 3);

  const never = await host({ docker: DOCKER, supabase: SUPABASE });
  const left = await program(repo, "test-db", [], {
    PATH: never.path,
    TMPDIR: tmp,
    STOP_FAILS: "99",
  });
  assert.equal(left.code, 1);
  assert.equal((await never.log()).match(/^supabase stop/gm)?.length, 10);
  assert.match(
    left.stderr,
    /^prune refused\ncould not stop the test stack knowno_test_\d+ after 10 attempts; remove it with: supabase stop --no-backup --project-id knowno_test_\d+\n$/,
  );
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("stops the stack and exits 130 on an interrupt", async () => {
  const { repo, tmp } = await fixture();
  const { path, log } = await host({ docker: DOCKER, supabase: SUPABASE });
  const child = new Deno.Command("env", {
    args: [
      "-u",
      "CI",
      `PATH=${path}`,
      `TMPDIR=${tmp}`,
      "START_PAUSE=20",
      "sh",
      "scripts/run.sh",
      "test-db",
    ],
    cwd: repo,
    stdout: "null",
    stderr: "null",
  }).spawn();
  for (
    let waited = 0;
    !(await log()).includes("supabase start") && waited < 100;
    waited++
  ) {
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(
    (await log()).includes("supabase start"),
    "setup: the stack started",
  );
  child.kill("SIGINT");
  const { code } = await child.status;
  assert.equal(code, 130);
  assert.ok((await log()).includes("supabase stop --no-backup"));
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("without Docker it skips, and fails where CI is set; without its daemon it skips", async () => {
  const { repo, tmp } = await fixture();
  const { path } = await host({ supabase: SUPABASE });
  const local = await program(repo, "test-db", [], { PATH: path, TMPDIR: tmp });
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped the database tests in supabase/tests/: they need Docker, and this host has no docker command\n",
  );
  const ci = await program(repo, "test-db", [], {
    PATH: path,
    TMPDIR: tmp,
    CI: "true",
  });
  assert.equal(ci.code, 1);

  const down = await host({ docker: DOCKER, supabase: SUPABASE });
  const daemon = await program(repo, "test-db", [], {
    PATH: down.path,
    TMPDIR: tmp,
    DOCKER_INFO: "1",
  });
  assert.equal(daemon.code, 0, daemon.stderr);
  assert.equal(
    daemon.stdout,
    "skipped the database tests in supabase/tests/: they need Docker, and docker info reached no daemon on this host\n",
  );
});

Deno.test("pgTapCounts reads the summary line", () => {
  assert.deepEqual(
    pgTapCounts("ok\nFiles=44, Tests=874,  4 wallclock secs\n"),
    { files: 44, tests: 874 },
  );
  assert.equal(pgTapCounts("Result: NOTESTS"), undefined);
});
