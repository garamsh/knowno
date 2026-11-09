// The card-form skills' seed (ADR 0197) is card_forms_seed.ts's texts, so every form has a first
// version, active. scripts/deno.ts grants this file read access to the migration alone.
import assert from "node:assert/strict";
import { FORMS } from "./card_forms.ts";
import { SEED, SEED_MARKUP } from "./card_forms_seed.ts";

const MIGRATION = "supabase/migrations/20261105150000_card_form_skills.sql";
const MARKUP_MIGRATION =
  "supabase/migrations/20261109150000_card_markup_switch.sql";

/** Each seeded version's form, summary and text, in [migration]'s order. */
async function seeded(
  migration = MIGRATION,
): Promise<[string, string, string][]> {
  const sql = await Deno.readTextFile(migration);
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

Deno.test("the markup migration seeds the text and cloze versions that teach the markup, character for character, labelled markup and none active", async () => {
  const rows = await seeded(MARKUP_MIGRATION);
  assert.deepEqual(rows.map(([form]) => form), ["text", "cloze"]);
  for (const [form, summary, text] of rows) {
    const seed = SEED_MARKUP[form as "text" | "cloze"];
    assert.equal(summary, seed.summary, form);
    assert.equal(text, seed.text, form);
    assert.ok(summary.length <= 300 && !/[\n\r]/.test(summary), form);
    assert.ok(text.length <= 20000, form);
    // Control: the markup version differs from the form's first version, so the label is the only
    // thing keeping it from being served while the switch is off.
    assert.notEqual(text, SEED[form as "text" | "cloze"].text, form);
  }
  const sql = await Deno.readTextFile(MARKUP_MIGRATION);
  assert.match(
    sql,
    /select s\.form, 'markup', s\.id from private\.card_form_skills/,
  );
});
