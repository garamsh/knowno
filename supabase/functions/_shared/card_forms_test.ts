// The card-form skills: their forms against the validator's block types, a card's form, the index,
// and the per-caller cache of what `card_form_skills` serves.
import assert from "node:assert/strict";
import { SupabaseError, type UserId } from "./auth.ts";
import { cardFormIndex, cardFormSkills, formOf, FORMS } from "./card_forms.ts";
import { SEED } from "./card_forms_seed.ts";
import { BLOCK_TYPES, readCard } from "./input.ts";
import type { Store } from "./store.ts";

let drawn = 0;
/** Ids that differ from each other, as a box's must. */
const ids = {
  now: () => 1_700_000_000_000,
  random: (bytes: number) => new Uint8Array(bytes).fill(++drawn % 256),
};

/** The card a seed's guide gives as its good example. */
function goodExample(text: string): unknown {
  const line = text.split("\n").find((_, index, lines) =>
    lines[index - 1] === "Good"
  );
  return JSON.parse(line ?? "null");
}

Deno.test("the forms are every block type the validator accepts and mixed, and a type outside them is refused", () => {
  assert.deepEqual([...FORMS], [...BLOCK_TYPES, "mixed"]);
  const refused = readCard(
    { blocks: [{ type: "flip", front: "a", back: "b" }] },
    ids,
  );
  assert.equal(typeof refused, "string");
  assert.match(String(refused), /type must be/);
  // Control: each type the list names is read as a card.
  for (const type of BLOCK_TYPES) {
    assert.notEqual(
      typeof readCard(goodExample(SEED[type].text), ids),
      "string",
      type,
    );
  }
});

Deno.test("each form's guide gives a good example the validator accepts as a card of that form", () => {
  for (const form of FORMS) {
    const card = readCard(goodExample(SEED[form].text), ids);
    assert.notEqual(typeof card, "string", `${form}: ${card}`);
    if (typeof card === "string") continue;
    assert.equal(formOf(card.blocks.map((block) => block.type)), form);
  }
});

Deno.test("a card's form is its one type besides text, text alone, or mixed for two or more", () => {
  assert.equal(formOf(["text"]), "text");
  assert.equal(formOf(["text", "text"]), "text");
  assert.equal(formOf(["text", "table"]), "table");
  assert.equal(formOf(["image", "text"]), "image");
  assert.equal(formOf(["senses", "senses"]), "senses");
  assert.equal(formOf(["senses", "cloze"]), "mixed");
  assert.equal(formOf(["text", "image", "table"]), "mixed");
  // A kept sound accompanies the card as text does.
  assert.equal(formOf(["audio", "text"]), "text");
  assert.equal(formOf(["audio", "cloze"]), "cloze");
});

const skills = Object.fromEntries(
  FORMS.map((form, index) => [form, { versionId: index, ...SEED[form] }]),
) as Parameters<typeof cardFormIndex>[0];

Deno.test("the index lists every form the validator accepts, with its summary and link, in the forms' order", () => {
  const index = cardFormIndex(skills, (form) => ` <${form}>`, "Closing.");
  const lines = index.split("\n").filter((line) => line.startsWith("- **"));
  assert.deepEqual(
    lines,
    FORMS.map((form) => `- **${form}** — ${SEED[form].summary} <${form}>`),
  );
  for (const type of BLOCK_TYPES) {
    assert.ok(index.includes(`- **${type}** — `), type);
  }
  assert.ok(index.endsWith("\nClosing.\n"));
});

/** A store for [userId] whose `card_form_skills` answers [rows], counting its calls. */
function storeOf(userId: string, answers: () => Response) {
  const calls: string[] = [];
  const store: Store = {
    url: "http://kong:8000",
    anonKey: "anon-key",
    token: `${userId}-token`,
    userId: userId as UserId,
    fetch: (input, init) => {
      calls.push(String(input));
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("apikey"), "anon-key");
      return Promise.resolve(answers());
    },
  };
  return { store, calls };
}

const rows = (text: string) =>
  FORMS.map((form, index) => ({
    form,
    version_id: index + 1,
    summary: SEED[form].summary,
    text: form === "cloze" ? text : SEED[form].text,
  }));

Deno.test("a caller's skills are read once and kept for a minute, then read again, and each caller's apart", async () => {
  let clock = 0;
  let served = "first";
  const forms = cardFormSkills(() => clock);
  const ada = storeOf("ada", () => Response.json(rows(served)));
  assert.equal((await forms.read(ada.store)).cloze.text, "first");
  served = "second";
  clock = 59_999;
  assert.equal((await forms.read(ada.store)).cloze.text, "first");
  assert.equal(ada.calls.length, 1);
  assert.deepEqual(ada.calls, [
    "http://kong:8000/rest/v1/rpc/card_form_skills",
  ]);
  // Another caller, an admin served another version, is read on its own.
  const grace = storeOf("grace", () => Response.json(rows(served)));
  assert.equal((await forms.read(grace.store)).cloze.text, "second");
  clock = 60_000;
  assert.equal((await forms.read(ada.store)).cloze.text, "second");
  assert.equal(ada.calls.length, 2);
});

Deno.test("an answer missing a form, repeating one or naming another fails, and is not kept", async () => {
  const forms = cardFormSkills(() => 0);
  const answers = [
    rows("x").filter((row) => row.form !== "image"),
    [...rows("x"), rows("x")[0]],
    [...rows("x"), { ...rows("x")[0], form: "flip" }],
    rows("x").map((row) => ({ ...row, version_id: String(row.version_id) })),
  ];
  for (const answer of answers) {
    const { store } = storeOf("ada", () => Response.json(answer));
    await assert.rejects(forms.read(store), SupabaseError);
  }
  const down = storeOf("ada", () => new Response(null, { status: 500 }));
  await assert.rejects(forms.read(down.store), SupabaseError);
  // Control: a whole answer is read, so the failures above were the rows', not the cache's.
  const whole = storeOf("ada", () => Response.json(rows("x")));
  assert.equal((await forms.read(whole.store)).cloze.text, "x");
});
