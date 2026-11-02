// scripts/migration-preview.ts's report and refusals, and scripts/test-migration-preview.ts's skip.
// The preview on a real stack is scripts/test-migration-preview.ts, which make test-db runs.
import assert from "node:assert/strict";
import { markdown, parseReport, pretty, Report } from "./migration-preview.ts";
import { commit, git, host, program, repository } from "./testing.ts";

const REPORT: Report = {
  tables: [
    {
      table: "public.a",
      status: "kept",
      columns: [
        { column: "x", status: "added", before: null, after: "int" },
        { column: "y", status: "dropped", before: "text", after: null },
        { column: "z", status: "altered", before: "int", after: "bigint" },
      ],
      rows_before: 2,
      rows_after: 2,
      added: 0,
      removed: 0,
      changed: 1,
    },
    {
      table: "public.b",
      status: "dropped",
      columns: [],
      rows_before: 3,
      rows_after: 0,
      added: 0,
      removed: 3,
      changed: 0,
    },
    {
      table: "public.c",
      status: "kept",
      columns: [],
      rows_before: 1,
      rows_after: 1,
      added: 0,
      removed: 0,
      changed: 0,
    },
  ],
  schemas: ["public", "private"],
  base: "abc",
  how: "where HEAD left origin/main",
  seeded: "main's supabase/preview-seed.sql",
  main: 38,
  new: ["29990101000000_n.sql"],
  edited: ["20260101000000_e.sql"],
};

Deno.test("markdown writes the report as the jq program did", () => {
  assert.equal(
    markdown(REPORT),
    `# Migration preview

Applied main's 38 migrations at \`abc\` (where HEAD left origin/main), loaded main's supabase/preview-seed.sql, then applied the 1 migrations this branch adds:

- \`29990101000000_n.sql\`

These migrations main has were changed here and not applied again, as production would not apply them again:

- \`20260101000000_e.sql\`

## Schema changes

- \`public.a\`: \`x\` added as \`int\`; \`y\` dropped, was \`text\`; \`z\` altered: \`int\` to \`bigint\`
- \`public.b\` dropped

## Rows changed per table

Rows are compared on the columns a table had before and still has, by its primary key; a value in an added column is not counted.

| Table | Rows before | Rows after | Added | Removed | Changed |
|---|---|---|---|---|---|
| \`public.a\` | 2 | 2 | 0 | 0 | 1 |
| \`public.b\` | 3 | 0 | 0 | 3 | 0 |

Compared 3 tables in the schemas public, private: every table there before or after; 1 had no row added, removed or changed.
`,
  );
});

Deno.test("markdown says none where nothing changed and no migration is new or edited", () => {
  const still = { ...REPORT, tables: [REPORT.tables[2]], new: [], edited: [] };
  const text = markdown(still);
  assert.ok(
    text.includes(
      "then applied the 0 migrations this branch adds:\n\n- None.\n\n## Schema changes\n\nNone.\n",
    ),
    text,
  );
  assert.ok(text.includes("not counted.\n\nNone.\n\nCompared 1 tables"), text);
});

Deno.test("pretty prints as jq does, and parseReport refuses a report without tables", () => {
  assert.equal(pretty({ a: [], b: null }), '{\n  "a": [],\n  "b": null\n}\n');
  assert.deepEqual(parseReport('{"tables":[],"schemas":[]}'), {
    tables: [],
    schemas: [],
  });
  assert.throws(() => parseReport('{"schemas":[]}'));
});

async function base(): Promise<string> {
  const repo = await repository();
  await commit(repo, "main");
  await git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  return repo;
}

Deno.test("refuses no report path, and one outside the temporary directory, with exit 2", async () => {
  const { path } = await host({});
  const tmp = await Deno.makeTempDir();
  const none = await program(await base(), "migration-preview", [], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(none.code, 2);
  assert.equal(
    none.stderr,
    "usage: scripts/run.sh migration-preview <report path, without extension>\n",
  );
  const outside = await program(await base(), "migration-preview", [
    "/elsewhere/report",
  ], { PATH: path, TMPDIR: tmp });
  assert.equal(outside.code, 2);
  assert.match(
    outside.stderr,
    /^the report path \/elsewhere\/report is outside /,
  );
});

Deno.test("fails without Docker, where the test of it skips, and fails where CI is set", async () => {
  const { path } = await host({});
  const tmp = await Deno.makeTempDir();
  const preview = await program(await base(), "migration-preview", [
    `${tmp}/report`,
  ], { PATH: path, TMPDIR: tmp });
  assert.equal(preview.code, 1);
  assert.equal(
    preview.stderr,
    "the migration preview needs Docker, and docker reached no daemon on this host\n",
  );

  const local = await program(await base(), "test-migration-preview", [], {
    PATH: path,
    TMPDIR: tmp,
  });
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped the migration preview test: it needs Docker, and docker reached no daemon on this host\n",
  );
  const ci = await program(await base(), "test-migration-preview", [], {
    PATH: path,
    TMPDIR: tmp,
    CI: "true",
  });
  assert.equal(ci.code, 1);
});
