// Tests scripts/migration-preview.ts, or says why it did not, in a repository it builds in a
// temporary directory: main holds this repository's supabase/ migrations and preview seed, and a
// merge commit, as CI checks a pull request out, adds a fixture migration and edits one of main's.
// It reads the report: the seed filling every table of public and private, each schema change and
// row count the fixture makes, a table it leaves alone as control, and the edited migration listed
// and not applied. The preview runs under its own grant from scripts/grants.txt.
import { isDeepStrictEqual } from "node:util";
import {
  entry,
  fail,
  grantOf,
  hasCommand,
  merged,
  read,
  Stop,
  succeeds,
} from "./process.ts";
import type { Report, Table } from "./migration-preview.ts";
import { skip } from "./skip.ts";

const FIXTURE =
  `alter table public.decks add column archived boolean not null default false;
update public.study_settings set daily_minutes = daily_minutes + 5;
alter table public.media drop column sha256;
alter table public.reviews alter column duration_ms type bigint;
delete from public.user_blocks;
create table public.tags (id uuid primary key, name text not null);
insert into public.tags values (gen_random_uuid(), 'fixture');
drop table private.revision_marks;
`;

async function copyInto(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isFile) {
      await Deno.copyFile(`${from}/${entry.name}`, `${to}/${entry.name}`);
    }
  }
}

async function main(): Promise<void> {
  if (!(await hasCommand("docker")) || !(await succeeds("docker", ["info"]))) {
    skip(
      "the migration preview test: it needs Docker, and docker reached no daemon on this host",
    );
    return;
  }
  const tmp = Deno.env.get("TMPDIR") || "/tmp";
  const work = await Deno.makeTempDir({ prefix: "migration-preview-test." });
  try {
    const repo = `${work}/repo`;
    const git = (...args: string[]) =>
      read("git", [
        "-C",
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        ...args,
      ]);
    await copyInto("supabase/migrations", `${repo}/supabase/migrations`);
    await copyInto("supabase/templates", `${repo}/supabase/templates`);
    for (
      const file of [
        "config.toml",
        "seed.sql",
        "preview-seed.sql",
        "migration-preview.sql",
      ]
    ) {
      await Deno.copyFile(`supabase/${file}`, `${repo}/supabase/${file}`);
    }
    await Deno.mkdir(`${repo}/scripts`);
    for await (const { name } of Deno.readDir("scripts")) {
      if (/\.(sh|ts|txt)$/.test(name) && !name.endsWith("_test.ts")) {
        await Deno.copyFile(`scripts/${name}`, `${repo}/scripts/${name}`);
      }
    }
    await git("init", "-q", "-b", "main");
    await git("add", "-A");
    await git("commit", "-q", "-m", "main");
    const first =
      (await Array.fromAsync(Deno.readDir(`${repo}/supabase/migrations`)))
        .map(({ name }) => name).toSorted()[0];

    await git("checkout", "-q", "-b", "branch");
    await Deno.writeTextFile(
      `${repo}/supabase/migrations/29991231000000_preview_fixture.sql`,
      FIXTURE,
    );
    await Deno.writeTextFile(
      `${repo}/supabase/migrations/${first}`,
      "create table public.edited_probe (id int primary key); insert into public.edited_probe values (1);\n",
      { append: true },
    );
    await git("add", "-A");
    await git("commit", "-q", "-m", "branch");
    await git("checkout", "-q", "main");
    await git("merge", "-q", "--no-ff", "-m", "merge", "branch");

    const grant = await grantOf("migration-preview", tmp);
    const ran = await merged("deno", [
      "run",
      "--quiet",
      "--no-prompt",
      ...grant,
      "scripts/migration-preview.ts",
      `${work}/report`,
    ], { cwd: repo });
    if (ran.code !== 0) {
      console.error(ran.output.split("\n").slice(-20).join("\n"));
      fail("the migration preview failed on the fixture repository");
    }

    const report: Report = JSON.parse(
      await Deno.readTextFile(`${work}/report.json`),
    );
    const check = (what: string, holds: boolean) => {
      if (!holds) {
        console.error(`the migration preview's report fails: ${what}`);
        console.error(JSON.stringify(report, null, 2));
        throw new Stop(1);
      }
    };
    const table = (name: string): Table | undefined =>
      report.tables.find((t) => t.table === name);
    const where = (name: string, holds: (t: Table) => boolean) => {
      const found = table(name);
      return found !== undefined && holds(found);
    };
    check(
      "it applies main's migrations, loads main's preview seed and applies the one new migration",
      report.seeded === "main's supabase/preview-seed.sql" &&
        isDeepStrictEqual(report.new, ["29991231000000_preview_fixture.sql"]),
    );
    check(
      "the preview seed puts rows in every table of public and private",
      report.tables.filter((t) =>
        /^(public|private)\./.test(t.table) && t.status !== "added" &&
        t.rows_before === 0
      )
        .length === 0,
    );
    check(
      "the edited migration of main's is listed, and not applied",
      isDeepStrictEqual(report.edited, [first]) &&
        table("public.edited_probe") === undefined,
    );
    check(
      "an added column is a schema change, and its values change no row",
      where("public.decks", (t) =>
        isDeepStrictEqual(t.columns, [{
          column: "archived",
          status: "added",
          before: null,
          after: "boolean not null default false",
        }]) && t.changed === 0),
    );
    check(
      "an update counts each row it changed, and no row added or removed",
      where(
        "public.study_settings",
        (t) =>
          t.rows_before > 0 && t.changed === t.rows_before && t.added === 0 &&
          t.removed === 0,
      ),
    );
    check(
      "a dropped column is listed with its definition before",
      where(
        "public.media",
        (t) =>
          isDeepStrictEqual(t.columns, [{
            column: "sha256",
            status: "dropped",
            before: "text not null",
            after: null,
          }]) &&
          t.changed === 0,
      ),
    );
    check(
      "an altered column is listed with its definitions before and after",
      where("public.reviews", (t) =>
        isDeepStrictEqual(t.columns, [{
          column: "duration_ms",
          status: "altered",
          before: "integer not null",
          after: "bigint not null",
        }])),
    );
    check(
      "a delete counts each row removed",
      where(
        "public.user_blocks",
        (t) =>
          t.rows_before > 0 && t.removed === t.rows_before &&
          t.rows_after === 0,
      ),
    );
    check(
      "an added table is listed with its rows",
      where("public.tags", (t) => t.status === "added" && t.rows_after === 1),
    );
    check(
      "a dropped table is listed with the rows it held",
      where(
        "private.revision_marks",
        (t) =>
          t.status === "dropped" && t.removed === t.rows_before &&
          t.rows_before > 0,
      ),
    );
    check(
      "a table the migration leaves alone reports no change",
      where(
        "public.cards",
        (t) =>
          t.rows_before > 0 && t.added + t.removed + t.changed === 0 &&
          t.columns.length === 0,
      ),
    );
    const md = (await Deno.readTextFile(`${work}/report.md`)).split("\n");
    for (
      const [line, what] of [
        [
          "| `public.study_settings` | 2 | 2 | 0 | 0 | 2 |",
          "the updated table's counts",
        ],
        [
          "- `public.media`: `sha256` dropped, was `text not null`",
          "the dropped column",
        ],
      ]
    ) {
      if (!md.includes(line)) {
        console.error(`the Markdown report does not list ${what}`);
        console.error(md.join("\n"));
        throw new Stop(1);
      }
    }
    console.log(
      `checked the migration preview on a merge adding a fixture migration over ${report.main} of main's: the seed in every table of public and private, a column added, dropped and altered, rows updated and deleted, a table added and dropped, ${report.tables.length} tables compared with public.cards unchanged as control, and the edited ${first} not applied`,
    );
  } finally {
    await Deno.remove(work, { recursive: true });
  }
}

if (import.meta.main) await entry(main);
