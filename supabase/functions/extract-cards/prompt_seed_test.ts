// The prompt store's seed (ADR 0073) is the prompt the function served before the store, so the
// deploy changes no user's prompt, and v9's activation (ADR 0080) saves prompt_v9.ts's text, which
// its pgTAP test expects too. scripts/deno.sh grants this file read access to those three SQL files alone.
import assert from "node:assert/strict";
import { SYSTEM_PROMPT } from "./prompt_v8.ts";
import { SYSTEM_PROMPT as V9 } from "./prompt_v9.ts";

const MIGRATION = "supabase/migrations/20261019210000_prompts.sql";

/** The text between [path]'s one pair of `$prompt$` quotes. */
async function quoted(path: string): Promise<string> {
  const sql = await Deno.readTextFile(path);
  const parts = sql.split("$prompt$");
  assert.equal(parts.length, 3, `${path} quotes one text with $prompt$`);
  return parts[1];
}

Deno.test("the migration seeds version 1 with prompt v8's text, character for character", async () => {
  const seeded = await quoted(MIGRATION);
  assert.equal(seeded, SYSTEM_PROMPT);
  // Control: a one-character difference is not equal, so the comparison reads the whole text.
  assert.notEqual(seeded, SYSTEM_PROMPT.slice(0, -1));
});

Deno.test("v9's activation saves prompt v9's text, and its pgTAP test expects it, character for character", async () => {
  for (
    const path of [
      "supabase/migrations/20261019230003_activate_prompt_v9.sql",
      "supabase/tests/prompt_v9_activation_test.sql",
    ]
  ) {
    const text = await quoted(path);
    assert.equal(text, V9, path);
    // Control: prompt v8, which the seed holds, is not equal, so the comparison reads the text.
    assert.notEqual(text, SYSTEM_PROMPT, path);
  }
});
