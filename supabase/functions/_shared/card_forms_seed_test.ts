// The card-form skills' seed (ADR 0197) is card_forms_seed.ts's texts, so every form has a first
// version, active. scripts/deno.ts grants this file read access to the migration alone.
import assert from "node:assert/strict";
import { FORMS } from "./card_forms.ts";
import { SEED } from "./card_forms_seed.ts";

const MIGRATION = "supabase/migrations/20261105150000_card_form_skills.sql";

/** Each seeded version's form, summary and text, in the migration's order. */
async function seeded(): Promise<[string, string, string][]> {
  const sql = await Deno.readTextFile(MIGRATION);
  return [
    ...sql.matchAll(
      /\('([a-z]+)',\n\$summary\$(.*?)\$summary\$,\n\$skill\$(.*?)\$skill\$/gs,
    ),
  ].map((row) => [row[1]!, row[2]!, row[3]!]);
}

Deno.test("the migration seeds one version of every form, each with its seed's summary and text, character for character", async () => {
  const rows = await seeded();
  assert.deepEqual(rows.map(([form]) => form), [...FORMS]);
  for (const [form, summary, text] of rows) {
    const seed = SEED[form as (typeof FORMS)[number]];
    assert.equal(summary, seed.summary, form);
    assert.equal(text, seed.text, form);
  }
  // Control: a one-character difference is not equal, so the comparison reads the whole text.
  assert.notEqual(rows[0]![2], SEED.text.text.slice(0, -1));
});
