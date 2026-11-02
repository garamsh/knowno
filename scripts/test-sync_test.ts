// scripts/test-sync.ts against stubs of Docker, the Supabase CLI and flutter.
import assert from "node:assert/strict";
import { flutterPassed } from "./test-sync.ts";
import { DOCKER, reservationsLeft, SUPABASE } from "./stacks_testing.ts";
import { host, program, RECORD, repository as bare } from "./testing.ts";

async function repository(): Promise<string> {
  const repo = await bare();
  await Deno.mkdir(`${repo}/app`);
  return repo;
}

const FLUTTER = `${RECORD}
echo "flutter env $KNOWNO_SYNC_TEST_URL $KNOWNO_SYNC_TEST_KEY $KNOWNO_SYNC_TEST_DB_CONTAINER" >>"$(dirname "$0")/calls"
echo "\${FLUTTER_SUMMARY:-00:05 +3: All tests passed!}"`;
const stubs = () => ({ docker: DOCKER, supabase: SUPABASE, flutter: FLUTTER });

Deno.test("runs the stack tests with the stack's URL, key and container, on two reserved ports", async () => {
  const { path, log } = await host(stubs());
  const tmp = await Deno.makeTempDir();
  const ran = await program(await repository(), "test-sync", [], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(ran.code, 0, ran.stderr);
  const env = (await log()).match(/^env knowno_sync_(\d+) (\d+) (\d+)$/m);
  assert.ok(env !== null, await log());
  assert.ok(
    Number(env[2]) >= 54400 && Number(env[2]) <= 54499 &&
      Number(env[3]) >= 54500 && Number(env[3]) <= 54599,
  );
  const calls = await log();
  assert.ok(
    calls.includes(
      "flutter test --concurrency=1 --reporter expanded --dart-define-from-file=config/dev.json test/sync/two_devices_test.dart test/sharing/sharing_server_test.dart test/account/suspension_test.dart\n",
    ),
    calls,
  );
  assert.ok(
    calls.includes(
      `flutter env http://127.0.0.1:54500 local-key supabase_db_knowno_sync_${
        env[1]
      }\n`,
    ),
    calls,
  );
  assert.ok(
    ran.stdout.endsWith(
      `ran 3 stack tests against the stack knowno_sync_${
        env[1]
      }, selected by: every test in app/ test/sync/two_devices_test.dart test/sharing/sharing_server_test.dart test/account/suspension_test.dart\n`,
    ),
    ran.stdout,
  );
  assert.ok(!ran.stdout.includes("local-key"), "a key was printed");
  assert.deepEqual(await reservationsLeft(tmp), []);
});

Deno.test("fails when a test skipped, and when the stack gave no endpoint, stopping it", async () => {
  const skipped = await host(stubs());
  const ran = await program(await repository(), "test-sync", [], {
    PATH: skipped.path,
    TMPDIR: await Deno.makeTempDir(),
    FLUTTER_SUMMARY: "00:05 +2 ~1: All tests passed!",
  });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "the stack tests skipped or ran no test: 00:05 +2 ~1: All tests passed!\n",
  );

  const bare = await host(stubs());
  const none = await program(await repository(), "test-sync", [], {
    PATH: bare.path,
    TMPDIR: await Deno.makeTempDir(),
    NO_ENDPOINT: "1",
  });
  assert.equal(none.code, 1);
  assert.match(
    none.stderr,
    /^supabase status gave no API_URL or PUBLISHABLE_KEY for the stack knowno_sync_\d+\n$/,
  );
  const calls = await bare.log();
  assert.ok(!calls.includes("flutter test"), calls);
  assert.ok(calls.includes("supabase stop --no-backup"), calls);
});

Deno.test("without Docker it skips, naming the tests", async () => {
  const { path } = await host({ supabase: SUPABASE, flutter: FLUTTER });
  const ran = await program(await repository(), "test-sync", [], {
    PATH: path,
    TMPDIR: await Deno.makeTempDir(),
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.match(
    ran.stdout,
    /^skipped the stack tests in app\/ \(test\/sync\/two_devices_test\.dart .*\): they need Docker, and this host has no docker command\n$/,
  );
});

Deno.test("flutterPassed reads the count only from a run where every test passed and none skipped", () => {
  assert.equal(flutterPassed("00:05 +18: All tests passed!"), 18);
  assert.equal(flutterPassed("00:05 +17 ~1: All tests passed!"), 0);
  assert.equal(flutterPassed("00:05 +17 -1: Some tests failed."), 0);
});
