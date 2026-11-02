// Runs the tests that need Auth and PostgREST, the two-device sync test
// app/test/sync/two_devices_test.dart, the sharing server test app/test/sharing/sharing_server_test.dart
// and the suspension test app/test/account/suspension_test.dart, against a local stack of its own,
// or says why it did not. The stack follows ADR 0014's pattern for the database tests: its own
// project id and reserved ports, stopped with its data however the run ends. It runs Postgres,
// Auth, PostgREST and the API gateway, which the tests sign in and sync through.
import { captured, entry, fail, Stop } from "./process.ts";
import { dockerReady, Stack, WITH_API } from "./stack.ts";

const TEST_FILES = [
  "test/sync/two_devices_test.dart",
  "test/sharing/sharing_server_test.dart",
  "test/account/suspension_test.dart",
];

/** The count on flutter's last line, "+<passed>: All tests passed!", which a skipped test changes. */
export function flutterPassed(summary: string): number {
  return Number(
    summary.match(/^[0-9:]* \+([0-9]*): All tests passed!$/)?.[1] || 0,
  );
}

async function main(): Promise<void> {
  const files = TEST_FILES.join(" ");
  if (!(await dockerReady(`the stack tests in app/ (${files})`))) return;
  const stack = new Stack("the sync test stack");
  const dbPort = await stack.reserve(54400, 54499);
  const apiPort = await stack.reserve(54500, 54599);
  stack.env.SUPABASE_PROJECT_ID = `knowno_sync_${dbPort}`;
  stack.env.SUPABASE_DB_PORT = `${dbPort}`;
  stack.env.SUPABASE_API_PORT = `${apiPort}`;
  await stack.run(async () => {
    await stack.start(WITH_API);
    const { url, key } = await stack.endpoint();
    // The two-device test runs the tombstone purge in the stack's database container.
    const { code, stdout } = await captured("flutter", [
      "test",
      "--concurrency=1",
      "--reporter",
      "expanded",
      "--dart-define-from-file=config/dev.json",
      ...TEST_FILES,
    ], {
      cwd: "app",
      env: {
        ...stack.env,
        KNOWNO_SYNC_TEST_URL: url,
        KNOWNO_SYNC_TEST_KEY: key,
        KNOWNO_SYNC_TEST_DB_CONTAINER: `supabase_db_${stack.projectId}`,
      },
    });
    const output = stdout.replace(/\n+$/, "");
    console.log(output);
    if (code !== 0) throw new Stop(1);
    const summary = output.split("\n").at(-1) ?? "";
    const passed = flutterPassed(summary);
    if (passed === 0) {
      fail(`the stack tests skipped or ran no test: ${summary}`);
    }
    console.log(
      `ran ${passed} stack tests against the stack ${stack.projectId}, selected by: every test in app/ ${files}`,
    );
  });
}

if (import.meta.main) await entry(main);
