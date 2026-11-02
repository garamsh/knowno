// Runs deno lint, format or test, as make lint, format and test ask, over the TypeScript of the Edge
// Functions in supabase/functions/, the eval in tools/eval/ and the programs in scripts/. The first
// two run as one set; scripts/ reports apart, under a grant of its own. The set's tests run with
// read access to tools/eval/ and to the prompt files' copies in SQL, the store's seed, v9's
// activation and its pgTAP test, which one test compares with the prompt files, only: no write,
// network or environment access, so a test that writes fails. A *_io_test.ts file runs apart,
// writing only under a temporary directory this program removes, and running deno, so it can run
// the eval as a subprocess under the eval's own grant.
import {
  attached,
  entry,
  fail,
  merged,
  scopeFiles,
  scopeText,
  Stop,
} from "./process.ts";

const FUNCTIONS_AND_EVAL = ["supabase/functions/*.ts", "tools/eval/*.ts"];
const SCRIPTS = ["scripts/*.ts"];
const READS = [
  "tools/eval",
  "supabase/migrations/20261019210000_prompts.sql",
  "supabase/migrations/20261019230003_activate_prompt_v9.sql",
  "supabase/tests/prompt_v9_activation_test.sql",
].join(",");

/** The count on the last of deno test's "ok | <n> passed" lines. */
export function passedCount(output: string): number {
  const counts = [...output.matchAll(/ok \| (\d+) passed/g)];
  return Number(counts.at(-1)?.[1] ?? 0);
}

/** Runs deno test with the flags over the files, prints its output and returns its count. */
async function denoTest(
  flags: string[],
  files: string[],
  env: Record<string, string>,
  none: string,
): Promise<number> {
  const { code, output } = await merged(
    "deno",
    ["test", "--no-prompt", ...flags, ...files],
    { env: { NO_COLOR: "1", ...env } },
  );
  console.log(output);
  if (code !== 0) throw new Stop(1);
  const passed = passedCount(output);
  if (passed === 0) fail(none);
  return passed;
}

async function selected(pathspecs: string[], none: string): Promise<string[]> {
  const files = await scopeFiles(pathspecs);
  if (files.length === 0) fail(`${none} by: ${scopeText(pathspecs)}`);
  return files;
}

const NO_FILE = "no TypeScript file was selected";
const SETS = [
  { pathspecs: FUNCTIONS_AND_EVAL, where: "" },
  { pathspecs: SCRIPTS, where: " in scripts/" },
];

async function lint(): Promise<void> {
  for (const { pathspecs, where } of SETS) {
    const files = await selected(pathspecs, NO_FILE);
    await attached("deno", ["lint", ...files]);
    await attached("deno", ["check", "--quiet", ...files]);
    console.log(
      `linted and type-checked ${files.length} TypeScript files${where}, selected by: ${
        scopeText(pathspecs)
      }`,
    );
  }
}

async function format(): Promise<void> {
  for (const { pathspecs, where } of SETS) {
    const files = await selected(pathspecs, NO_FILE);
    await attached("deno", ["fmt", "--check", ...files]);
    console.log(
      `format checked ${files.length} TypeScript files${where}, selected by: ${
        scopeText(pathspecs)
      }`,
    );
  }
}

async function withTemporaryDirectory<T>(
  use: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir();
  try {
    return await use(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function test(): Promise<void> {
  const scope = scopeText(FUNCTIONS_AND_EVAL);
  const files = await selected(
    FUNCTIONS_AND_EVAL,
    "no TypeScript file was selected",
  );
  const isTest = (file: string) => file.endsWith("_test.ts");
  const isIoTest = (file: string) => file.endsWith("_io_test.ts");
  const tests = files.filter((file) => isTest(file) && !isIoTest(file));
  const ioTests = files.filter(isIoTest);
  if (tests.length === 0) fail(`no *_test.ts file was selected by: ${scope}`);

  let passed = await denoTest(
    [`--allow-read=${READS}`],
    tests,
    {},
    "deno test ran no test",
  );
  if (ioTests.length > 0) {
    passed += await withTemporaryDirectory((dir) =>
      denoTest(
        [
          `--allow-read=tools/eval,${dir}`,
          `--allow-write=${dir}`,
          "--allow-run=deno",
        ],
        ioTests,
        { TMPDIR: dir },
        "deno test ran no *_io_test.ts test",
      )
    );
  }
  console.log(
    `ran ${passed} Deno tests in ${
      tests.length + ioTests.length
    } files, selected as the *_test.ts files among: ${scope}`,
  );

  const scripts = (await selected(SCRIPTS, NO_FILE))
    .filter(isTest);
  if (scripts.length === 0) {
    fail(`no *_test.ts file was selected by: ${scopeText(SCRIPTS)}`);
  }
  // Each test builds its fixture repository under the directory, and runs git and these programs;
  // a stack test listens on a local port.
  const ranScripts = await withTemporaryDirectory((dir) =>
    denoTest(
      [
        `--allow-read=scripts,${dir}`,
        `--allow-write=${dir}`,
        "--allow-run=env",
        "--allow-net=127.0.0.1",
      ],
      scripts,
      { TMPDIR: dir },
      "deno test ran no test in scripts/",
    )
  );
  console.log(
    `ran ${ranScripts} Deno tests in ${scripts.length} files of scripts/, selected as the *_test.ts files among: ${
      scopeText(SCRIPTS)
    }`,
  );
}

async function main([task]: string[]): Promise<void> {
  if (task === "lint") return await lint();
  if (task === "format") return await format();
  if (task === "test") return await test();
  fail("usage: scripts/run.sh deno lint|format|test", 2);
}

if (import.meta.main) await entry(main);
