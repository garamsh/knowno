// The conversion of stored cards to the card text markup (#955, ADR 0254) is tested in SQL on the
// engine's escape and version 1 cloze fixtures, which supabase/tests/card_markup_only_test.sql holds
// as copies, since scripts/test-db.ts hands a test no file of its own. This fails when a copy
// differs from its file. scripts/deno.ts grants this file read access to that test alone.
import assert from "node:assert/strict";
import escape from "../../../engine/tests/fixtures/markup/escape.json" with {
  type: "json",
};
import v1 from "../../../engine/tests/fixtures/markup/v1.json" with {
  type: "json",
};

const TEST = "supabase/tests/card_markup_only_test.sql";

/** The JSON between [tag]'s two dollar quotes in the SQL test. */
function copied(sql: string, tag: string): unknown {
  const found = sql.match(new RegExp(`\\$${tag}\\$\\n(.*?)\\$${tag}\\$`, "s"));
  assert.ok(found, `${tag} is quoted in the SQL test`);
  return JSON.parse(found[1]!);
}

Deno.test("the SQL test's escape and version 1 cloze lists are the engine's fixtures", async () => {
  const sql = await Deno.readTextFile(TEST);
  assert.deepEqual(copied(sql, "escape"), escape);
  assert.deepEqual(copied(sql, "v1"), v1);
  // Control: a changed case is a different list, so the comparison reads every case.
  assert.notDeepEqual(
    copied(sql, "escape"),
    escape.map((fixture, index) =>
      index === 0 ? { ...fixture, escaped: "x" } : fixture
    ),
  );
});
