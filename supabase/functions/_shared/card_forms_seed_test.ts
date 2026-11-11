// The card-form skills' seed (ADR 0197, ADR 0254) is card_forms_seed.ts's texts, so every form has
// a version served: the first migration seeds the forms other than `text`, `cloze` and `mixed`,
// and the markup-only migration those three. scripts/deno.ts grants this file read access to the two
// migrations alone.
import assert from "node:assert/strict";
import { FORMS } from "./card_forms.ts";
import { SEED } from "./card_forms_seed.ts";

const MIGRATION = "supabase/migrations/20261105150000_card_form_skills.sql";
const MARKUP_MIGRATION =
  "supabase/migrations/20261112120000_card_markup_only.sql";
const MARKUP_FORMS = ["text", "cloze", "mixed"] as const;

/** Each seeded version's form, summary and text, in [migration]'s order. */
async function seeded(
  migration: string,
): Promise<[string, string, string][]> {
  const sql = await Deno.readTextFile(migration);
  return [
    ...sql.matchAll(
      /\('([a-z]+)',\n\$summary\$(.*?)\$summary\$,\n\$skill\$(.*?)\$skill\$/gs,
    ),
  ].map((row) => [row[1]!, row[2]!, row[3]!]);
}

Deno.test("the first migration seeds one version of every form, and the forms but text, cloze and mixed are their seed's summary and text, character for character", async () => {
  const rows = await seeded(MIGRATION);
  assert.deepEqual(rows.map(([form]) => form), [...FORMS]);
  for (const [form, summary, text] of rows) {
    if ((MARKUP_FORMS as readonly string[]).includes(form)) continue;
    const seed = SEED[form as (typeof FORMS)[number]];
    assert.equal(summary, seed.summary, form);
    assert.equal(text, seed.text, form);
  }
  // Control: a one-character difference is not equal, so the comparison reads the whole text.
  assert.notEqual(rows[1]![2], SEED.senses.text.slice(0, -1));
});

Deno.test("the markup-only migration appends the text, cloze and mixed versions that teach the markup, character for character, and makes them active", async () => {
  const rows = await seeded(MARKUP_MIGRATION);
  assert.deepEqual(rows.map(([form]) => form), [...MARKUP_FORMS]);
  for (const [form, summary, text] of rows) {
    const seed = SEED[form as (typeof MARKUP_FORMS)[number]];
    assert.equal(summary, seed.summary, form);
    assert.equal(text, seed.text, form);
    assert.ok(summary.length <= 300 && !/[\n\r]/.test(summary), form);
    assert.ok(text.length <= 20000, form);
    if (form === "cloze") assert.match(text, /\{\{c1::/, form);
    // The older cloze form is refused, so no text calls it accepted.
    assert.doesNotMatch(text, /still accepted|"answers"/, form);
  }
  const sql = await Deno.readTextFile(MARKUP_MIGRATION);
  assert.match(
    sql,
    /select s\.form, 'active', s\.id from private\.card_form_skills as s where s\.note = 'markup only \(#955\)'/,
  );
});
