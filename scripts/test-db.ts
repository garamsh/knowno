// Runs the pgTAP tests in supabase/tests/ against a local stack of its own, or says why it did not.
// The stack gets its own project id and database port, so concurrent runs and the shared knowno
// stack never meet; it is stopped, with its data, however the run ends.
import { captured, entry, fail, fed, Stop } from "./process.ts";
import { DATABASE_ONLY, dockerReady, Stack } from "./stack.ts";

/** The test and file counts of pgTAP's "Files=<n>, Tests=<n>," line. */
export function pgTapCounts(
  output: string,
): { tests: number; files: number } | undefined {
  const found = output.match(/^Files=(\d*), Tests=(\d*),/m);
  if (found === null) return undefined;
  return { files: Number(found[1]), tests: Number(found[2]) };
}

/** A file's content as `$(cat file)` gives it, without its trailing newlines. */
async function content(path: string): Promise<string> {
  return (await Deno.readTextFile(path)).replace(/\n+$/, "");
}

const SETTINGS =
  `alter database postgres set knowno.card_frame_dry_run = :'query';
alter database postgres set knowno.card_frame_fixtures = :'fixtures';
`;

async function main(): Promise<void> {
  if (!(await dockerReady("the database tests in supabase/tests/"))) return;
  const stack = new Stack("the test stack");
  const port = await stack.reserve(54400, 54499);
  stack.env.SUPABASE_PROJECT_ID = `knowno_test_${port}`;
  stack.env.SUPABASE_DB_PORT = `${port}`;
  await stack.run(async () => {
    await stack.start(DATABASE_ONLY);
    // `supabase test db` mounts supabase/tests/ alone, so the dry run's file reaches its test,
    // card_frame_dry_run_test.sql, and the frame's fixtures card_frame_migration_test.sql, as
    // database settings each test's session reads.
    await fed(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${stack.projectId}`,
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `query=${await content("supabase/card-frame-dry-run.sql")}`,
        "-v",
        `fixtures=${await content(
          "supabase/fixtures/card-frame/conversion.json",
        )}`,
      ],
      SETTINGS,
      { env: stack.env, print: true },
    );
    const { code, stdout } = await captured("supabase", [
      "test",
      "db",
      "--local",
    ], {
      env: stack.env,
    });
    const output = stdout.replace(/\n+$/, "");
    console.log(output);
    if (code !== 0) throw new Stop(1);
    const counts = pgTapCounts(output);
    if (counts === undefined || counts.tests === 0) {
      fail("supabase test db ran no pgTAP test");
    }
    console.log(
      `ran ${counts.tests} pgTAP tests in ${counts.files} files against the stack ${stack.projectId}, selected by supabase test db: every file under supabase/tests/`,
    );
  });
}

if (import.meta.main) await entry(main);
