// Previews what this branch's migrations do to a database holding data: on a throwaway local stack,
// applies main's migrations, loads main's supabase/preview-seed.sql, applies the migrations this
// branch adds, and writes the tables and columns added, dropped or altered and the rows added,
// removed and changed per table: <out>.json as supabase/migration-preview.sql reports it, and
// <out>.md for the pull request. The stack is stopped, with its data, however the run ends
// (ADR 0014). Production data never reaches it (server.md). main is read as migration-base.ts
// reads it. <out> is under the temporary directory, the one place the program may write.
import {
  findBase,
  MIGRATIONS,
  namesHere,
  namesOnMain,
} from "./migration-base.ts";
import {
  attached,
  captured,
  entry,
  fail,
  fed,
  hasCommand,
  read,
  succeeds,
} from "./process.ts";
import { DATABASE_ONLY, Stack } from "./stack.ts";

export type Column = {
  column: string;
  status: string;
  before: string | null;
  after: string | null;
};
export type Table = {
  table: string;
  status: string;
  columns: Column[];
  rows_before: number;
  rows_after: number;
  added: number;
  removed: number;
  changed: number;
};
export type Report = {
  tables: Table[];
  schemas: string[];
  base: string;
  how: string;
  seeded: string;
  main: number;
  new: string[];
  edited: string[];
};

/** supabase/migration-preview.sql's report, refused unless it holds its tables and schemas. */
export function parseReport(
  text: string,
): Omit<Report, "base" | "how" | "seeded" | "main" | "new" | "edited"> {
  const parsed: unknown = JSON.parse(text);
  const value = parsed as { tables?: unknown; schemas?: unknown } | null;
  if (!Array.isArray(value?.tables) || !Array.isArray(value?.schemas)) {
    fail("migration_preview.report() returned no tables and schemas");
  }
  return parsed as Omit<
    Report,
    "base" | "how" | "seeded" | "main" | "new" | "edited"
  >;
}

const moved = (t: Table) =>
  t.status !== "kept" || t.added + t.removed + t.changed > 0;

function column(c: Column): string {
  const head = `\`${c.column}\` ${c.status}`;
  if (c.status === "added") return `${head} as \`${c.after}\``;
  if (c.status === "dropped") return `${head}, was \`${c.before}\``;
  return `${head}: \`${c.before}\` to \`${c.after}\``;
}

/** The report for the pull request. */
export function markdown(r: Report): string {
  const listed = (names: string[]) =>
    names.map((name) => `- \`${name}\``).join("\n");
  const schema = r.tables.filter((t) =>
    t.status !== "kept" || t.columns.length > 0
  )
    .map((t) =>
      t.status === "kept"
        ? `- \`${t.table}\`: ${t.columns.map(column).join("; ")}`
        : `- \`${t.table}\` ${t.status}`
    );
  const rows = r.tables.filter(moved).map((t) =>
    `| \`${t.table}\` | ${t.rows_before} | ${t.rows_after} | ${t.added} | ${t.removed} | ${t.changed} |`
  );
  return [
    "# Migration preview",
    "",
    `Applied main's ${r.main} migrations at \`${r.base}\` (${r.how}), loaded ${r.seeded}, then applied the ${r.new.length} migrations this branch adds:`,
    "",
    r.new.length === 0 ? "- None." : listed(r.new),
    "",
    ...(r.edited.length > 0
      ? [
        "These migrations main has were changed here and not applied again, as production would not apply them again:\n\n" +
        listed(r.edited) + "\n",
      ]
      : []),
    "## Schema changes",
    "",
    schema.length === 0 ? "None." : schema.join("\n"),
    "",
    "## Rows changed per table",
    "",
    "Rows are compared on the columns a table had before and still has, by its primary key; a value in an added column is not counted.",
    "",
    rows.length === 0 ? "None." : [
      "| Table | Rows before | Rows after | Added | Removed | Changed |",
      "|---|---|---|---|---|---|",
      ...rows,
    ]
      .join("\n"),
    "",
    `Compared ${r.tables.length} tables in the schemas ${
      r.schemas.join(", ")
    }: every table there before or after; ${
      r.tables.filter((t) => !moved(t)).length
    } had no row added, removed or changed.`,
  ].join("\n") + "\n";
}

/** jq's pretty printing, which the JSON report was written in. */
export function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 1) {
    fail(
      "usage: scripts/run.sh migration-preview <report path, without extension>",
      2,
    );
  }
  const tmp = Deno.env.get("TMPDIR") || "/tmp";
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname)
    .replace(/\/$/, "");
  const out = args[0].startsWith("/") ? args[0] : `${root}/${args[0]}`;
  if (!out.startsWith(`${tmp}/`)) {
    fail(
      `the report path ${
        args[0]
      } is outside ${tmp}, the temporary directory this program may write in`,
      2,
    );
  }
  const base = await findBase();
  if (base === undefined) {
    fail(
      `found no base to preview ${MIGRATIONS}/ against: HEAD is no merge commit and origin/main is unknown`,
    );
  }
  const onMain = await namesOnMain(base.commit);
  const here = await namesHere();
  const fresh = here.filter((name) => !onMain.includes(name));
  // A migration main has that this branch changed: the integration applies none it already applied.
  const edited: string[] = [];
  for (const name of here.filter((name) => onMain.includes(name))) {
    if (
      !(await succeeds("git", [
        "diff",
        "--quiet",
        base.commit,
        "--",
        `${MIGRATIONS}/${name}`,
      ]))
    ) {
      edited.push(name);
    }
  }
  if (!(await hasCommand("docker")) || !(await succeeds("docker", ["info"]))) {
    fail(
      "the migration preview needs Docker, and docker reached no daemon on this host",
    );
  }

  const stack = new Stack("the migration preview stack");
  const port = await stack.reserve(54400, 54499);
  stack.env.SUPABASE_PROJECT_ID = `knowno_preview_${port}`;
  stack.env.SUPABASE_DB_PORT = `${port}`;
  const work = await Deno.makeTempDir({ prefix: "migration-preview." });
  stack.onStop(() => Deno.remove(work, { recursive: true }));
  await stack.run(async () => {
    // main's supabase/ as the stack's project: its config and migrations, and its empty seed.sql.
    await attached("git", [
      "archive",
      `--output=${work}/main.tar`,
      base.commit,
      "supabase/config.toml",
      "supabase/seed.sql",
      MIGRATIONS,
    ]);
    await attached("tar", ["-x", "-C", work, "-f", `${work}/main.tar`]);
    await Deno.remove(`${work}/main.tar`);
    const seed = await captured("git", [
      "show",
      `${base.commit}:supabase/preview-seed.sql`,
    ], {
      quiet: true,
    });
    const seeded = seed.code === 0
      ? "main's supabase/preview-seed.sql"
      : "no rows: main has no supabase/preview-seed.sql";
    await Deno.writeTextFile(
      `${work}/preview-seed.sql`,
      seed.code === 0 ? seed.stdout : "",
    );

    await stack.start(DATABASE_ONLY, work);
    const sql = (input: string, print = true) =>
      fed(
        "docker",
        [
          "exec",
          "-i",
          `supabase_db_${stack.projectId}`,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        input,
        { env: stack.env, print },
      );
    await sql(await Deno.readTextFile(`${work}/preview-seed.sql`));
    await sql(await Deno.readTextFile("supabase/migration-preview.sql"));
    await sql("select migration_preview.snapshot();\n", false);

    for (const name of fresh) {
      await Deno.copyFile(
        `${MIGRATIONS}/${name}`,
        `${work}/${MIGRATIONS}/${name}`,
      );
    }
    await read("supabase", ["migration", "up", "--local", "--workdir", work], {
      env: stack.env,
    });

    const report: Report = {
      ...parseReport(await sql("select migration_preview.report();\n", false)),
      base: base.commit,
      how: base.how,
      seeded,
      main: onMain.length,
      new: fresh,
      edited,
    };
    await Deno.writeTextFile(`${out}.json`, pretty(report));
    await Deno.writeTextFile(`${out}.md`, markdown(report));
    console.log(
      `wrote ${out}.json and ${out}.md: ${fresh.length} new migrations applied over main's ${onMain.length} at ${base.commit} (${base.how}), ${
        report.tables.filter(moved).length
      } of ${report.tables.length} tables with rows or the table changed`,
    );
  });
}

if (import.meta.main) await entry(main);
