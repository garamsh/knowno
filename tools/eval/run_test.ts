// The eval end to end with OpenRouter and the file system replaced by in-memory fakes.
import assert from "node:assert/strict";
import { OPENROUTER_URL } from "../../supabase/functions/extract-cards/providers.ts";
import { composeInstructions } from "../../supabase/functions/extract-cards/cards.ts";
import * as v9 from "../../supabase/functions/extract-cards/prompt_v9.ts";
import { SYSTEM_PROMPT } from "../../supabase/functions/extract-cards/prompt_v10.ts";
import { ALTERNATIVES, LEAN_CONTRACT } from "./dense.ts";
import { meaningOf, normalize, score } from "./metrics.ts";
import { MODELS_URL, newest, parseModels, parseSelectors } from "./models.ts";
import { type Io, loadSamples, main, PATHS, runEval } from "./run.ts";
import {
  estimateUsd,
  TYPICAL_NOTE_TOKENS_PER_CARD,
  TYPICAL_VOCABULARY_TOKENS_PER_CARD,
  worstCallUsd,
} from "./budget.ts";

const NOUN = { kind: "part_of_speech", category: "noun", text: "n." } as const;
const truth = [{
  front: "apple",
  senses: [{ labels: [NOUN], meaning: "사과", examples: [] }],
}, {
  front: "river",
  senses: [{ labels: [], meaning: "강", examples: [] }],
}];
/** The same cards as the model writes them, one inventing an example. */
const modelCards = [
  {
    kind: "vocabulary",
    type: "concept",
    front: "apple",
    answer: null,
    topic: "Unit 1",
    senses: [{ labels: [NOUN], meaning: "사과", examples: [] }],
    extras: [],
    pronunciation: null,
    examples: ["She ate an apple."],
    table: null,
    cloze: null,
  },
  {
    kind: "vocabulary",
    type: "concept",
    front: "river",
    answer: null,
    topic: "Unit 1",
    senses: [{ labels: [], meaning: "강", examples: [] }],
    extras: [],
    pronunciation: null,
    examples: [],
    table: null,
    cloze: null,
  },
];
/** A notes page's ground truth, and the note cards a model writes for it. */
const notesTruth = {
  kind: "notes",
  facts: [
    {
      id: "deduction",
      step: 1,
      terms: ["연역", "반드시"],
      examples: ["253+4637+647898=652788 -> 연역"],
    },
    { id: "induction", step: 2, terms: ["귀납", "개연"] },
  ],
  lines: [
    "5. 연역과 귀납",
    "연역 논증: 전제가 참이면 결론이 반드시 참",
    "예) 253+4637+647898=652788 -> 연역",
  ],
};
const noteCards = [{
  kind: "note",
  type: "concept",
  front: "연역 논증",
  answer: "전제가 참이면 결론이 반드시 참인 논증",
  topic: "연역과 귀납",
  senses: [],
  extras: [],
  pronunciation: null,
  examples: ["253+4637+647898=652788 -> 연역"],
  table: null,
  cloze: null,
}];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
/** A notes sample's image, told apart from the vocabulary ones by its bytes. */
const NOTES_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 9, 9]);
const NOTES_IMAGE = btoa(String.fromCharCode(...NOTES_JPEG));

const model = (
  id: string,
  created: number,
  prompt = "0.000001",
  extra: Record<string, unknown> = {},
) => ({
  id,
  created,
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  },
  supported_parameters: ["max_tokens", "response_format", "structured_outputs"],
  pricing: { prompt, completion: "0.000004", image: "0", request: "0" },
  ...extra,
});

const MODEL_LIST = {
  data: [
    model("vendor/cheap", 1),
    model("vendor/cheap-old", 0),
    model("vendor/dear", 2, "0.00001"),
    model("vendor/text-only", 3, "0.000001", {
      architecture: { input_modalities: ["text"] },
    }),
    model("vendor/no-schema", 4, "0.000001", {
      supported_parameters: ["response_format"],
    }),
    model("vendor/broken", 5),
    model("vendor/flaky", 6),
  ],
};

type World = {
  files: Map<string, string>;
  chatCalls: string[];
  printed: string[];
  /** The cost each chat reply reports. */
  replyCost: number;
  /** The cards the model writes for a notes image, `noteCards` unless a test sets its own. */
  notesReply?: unknown[];
  /** The cards the model writes for a vocabulary image, when a test sets its own. */
  vocabularyReply?: unknown[];
  /** How many of the first chat calls never answer. */
  hangs?: number;
  /** Each chat call's system prompt, in call order. */
  systems?: string[];
};

/** The error body OpenRouter answers a call to `vendor/broken` with, and `vendor/flaky`'s first. */
const ERROR_BODY = {
  error: { code: 400, message: "Provider returned error", metadata: {} },
};

function world(
  ledger = { budgetUsd: 10, runs: [] as unknown[] },
  candidates?: unknown,
): World {
  const files = new Map<string, string>([
    [
      PATHS.candidates,
      JSON.stringify(
        candidates ?? [{ label: "Cheap", primary: "^vendor/cheap" }, {
          label: "Dear",
          primary: "^vendor/dear$",
        }],
      ),
    ],
    [PATHS.ledger, JSON.stringify(ledger)],
    [
      `${PATHS.samples}/01-a.json`,
      JSON.stringify({
        image: "01-a.jpg",
        languages: { front: "en", back: "ko" },
        cards: truth,
      }),
    ],
    [
      `${PATHS.samples}/02-b.json`,
      JSON.stringify({ image: "02-b.jpg", cards: truth }),
    ],
  ]);
  return { files, chatCalls: [], printed: [], replyCost: 0.001 };
}

function io(
  w: World,
  env: Record<string, string> = { OPENROUTER_API_KEY: "key" },
): Io {
  return {
    fetch: (input, init) => {
      const url = String(input);
      if (url === MODELS_URL) return Promise.resolve(Response.json(MODEL_LIST));
      if (url === OPENROUTER_URL) {
        const body = JSON.parse(String(init?.body));
        w.chatCalls.push(body.model);
        w.systems?.push(body.messages[0].content);
        if (w.chatCalls.length <= (w.hangs ?? 0)) {
          return new Promise<Response>(() => {});
        }
        if (
          body.model === "vendor/broken" ||
          (body.model === "vendor/flaky" &&
            w.chatCalls.filter((m) => m === "vendor/flaky").length === 1)
        ) {
          return Promise.resolve(Response.json(ERROR_BODY, { status: 400 }));
        }
        const notes = JSON.stringify(body.messages).includes(NOTES_IMAGE);
        const cards = notes
          ? w.notesReply ?? noteCards
          : w.vocabularyReply !== undefined
          ? w.vocabularyReply
          : body.model === "vendor/dear"
          ? modelCards
          : modelCards.slice(0, 1);
        return Promise.resolve(Response.json({
          choices: [{ message: { content: JSON.stringify({ cards }) } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 50,
            cost: w.replyCost,
          },
        }));
      }
      throw new Error(`unexpected request to ${url}`);
    },
    now: () => 0,
    env: (name) => env[name],
    readText: (path) => {
      const text = w.files.get(path);
      return text === undefined
        ? Promise.reject(new Error(`no file ${path}`))
        : Promise.resolve(text);
    },
    readBytes: (path) =>
      Promise.resolve(path.includes("notes") ? NOTES_JPEG : JPEG),
    list: () =>
      Promise.resolve(
        [...w.files.keys()].filter((p) => p.startsWith(PATHS.samples)).map((
          p,
        ) => p.slice(PATHS.samples.length + 1)),
      ),
    writeText: (path, text) => {
      w.files.set(path, text);
      return Promise.resolve();
    },
    print: (line) => w.printed.push(line),
    today: () => "2026-10-15",
    startedAt: () => "2026-10-15T04:05:06.789Z",
  };
}

Deno.test("only models taking images with structured outputs are candidates, the newest match chosen", () => {
  const models = parseModels(MODEL_LIST);
  assert.deepEqual(models.map((m) => m.id), [
    "vendor/cheap",
    "vendor/cheap-old",
    "vendor/dear",
    "vendor/broken",
    "vendor/flaky",
  ]);
  assert.equal(newest("^vendor/cheap", models)?.id, "vendor/cheap");
  assert.equal(newest("^vendor/text-only$", models), null);
});

Deno.test("a candidate naming a retry is refused, since the function makes one call per photo", () => {
  assert.throws(
    () =>
      parseSelectors([{ label: "Haiku", primary: "^a/b$", retry: "^a/c$" }]),
    /malformed candidate/,
  );
  assert.deepEqual(
    parseSelectors([{ label: "Haiku", primary: "^a/b$" }]),
    [{ label: "Haiku", primary: "^a/b$" }],
    "control: the same candidate without a retry",
  );
});

Deno.test("a dry run prints the resolved models and the estimate, and calls no model", async () => {
  const w = world();
  assert.equal(await main(["--dry-run"], io(w, {})), 0);
  assert.equal(w.chatCalls.length, 0);
  assert.ok(
    w.printed.some((line) =>
      line.startsWith("Dear: ") && line.includes("`vendor/dear`") &&
      !line.includes("retry")
    ),
  );
  assert.ok(
    w.printed.some((line) =>
      /2 samples \(2 vocabulary, 0 notes\) x 2 configurations x prompt v10: estimated \$\d/
        .test(line)
    ),
  );
  assert.equal(w.files.get(PATHS.report), undefined);
});

Deno.test("a run whose estimate exceeds the remaining budget is refused before any call", async () => {
  const nearlySpent = world({
    budgetUsd: 10,
    runs: [{ date: "2026-10-01", spentUsd: 9.999, note: "" }],
  });
  assert.equal(await main([], io(nearlySpent)), 1);
  assert.equal(nearlySpent.chatCalls.length, 0);
  assert.ok(
    nearlySpent.printed.includes(
      "refused: the estimate exceeds the remaining budget",
    ),
  );
  assert.equal(
    JSON.parse(nearlySpent.files.get(PATHS.ledger) ?? "").runs.length,
    1,
    "the ledger is unchanged",
  );

  const control = world();
  assert.equal(
    await main([], io(control)),
    0,
    "control: the same run with the budget unspent",
  );
  assert.ok(control.chatCalls.length > 0);
});

Deno.test("a run records its spend in the ledger and writes the results table", async () => {
  const w = world({
    budgetUsd: 10,
    runs: [{ date: "2026-10-01", spentUsd: 1, note: "earlier" }],
  });
  assert.equal(await main([], io(w)), 0);
  assert.deepEqual(w.chatCalls, [
    "vendor/cheap",
    "vendor/cheap",
    "vendor/dear",
    "vendor/dear",
  ]);
  const ledger = JSON.parse(w.files.get(PATHS.ledger) ?? "");
  assert.deepEqual(ledger.runs.at(-1), {
    date: "2026-10-15",
    spentUsd: 0.004,
    note: "prompt v10",
  });
  assert.ok(
    w.printed.includes(
      "this run spent $0.0040; $1.0040 of $10.0000 spent in total",
    ),
  );

  const table = w.files.get(PATHS.report) ?? "";
  assert.match(
    table,
    /\| Cheap \| 100\.0 \| 50\.0 \| 66\.7 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| — \| 0\.0 \| — \| — \| 50\.0 \| 0\.0 \| 0\.0 s \| 0\.0 s \| \$0\.0010 \| \$0\.0020 \|/,
  );
  assert.match(
    table,
    /\| Dear \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 100\.0 \| 0\.0 \|/,
    "river, printed without a label, was given none",
  );
  assert.match(
    table,
    /## Vocabulary per page\n\n\| Page \| Configuration \| F1 \|[^\n]*\n\|[-|]+\n\| 01-a \| Cheap \| 66\.7 \| /,
  );
  assert.match(table, /\| 02-b \| Dear \| 100\.0 \| /);
  assert.match(
    table,
    /- Dear: the cheapest configuration whose vocabulary F1 is within 2 points/,
  );
  assert.match(table, /All runs: \$1\.0040 of the \$10\.0000 budget/);
  assert.doesNotMatch(table, /## Notes pages/, "no notes image ran");
});

/** An I/O whose write to [failing] rejects, as a missing grant does, after the paid calls. */
function failingWrite(w: World, failing: string): Io {
  const base = io(w);
  return {
    ...base,
    writeText: (path, text) =>
      path === failing
        ? Promise.reject(new Error(`no write access to ${path}`))
        : base.writeText(path, text),
  };
}

Deno.test("a failed report write still records the run in the ledger", async () => {
  const w = world();
  await assert.rejects(
    main([], failingWrite(w, PATHS.report)),
    /no write access to docs\/eval/,
  );
  assert.equal(w.chatCalls.length, 4, "the calls were made");
  assert.equal(w.files.get(PATHS.report), undefined);
  assert.deepEqual(JSON.parse(w.files.get(PATHS.ledger) ?? "").runs, [{
    date: "2026-10-15",
    spentUsd: 0.004,
    note: "prompt v10",
  }]);
});

Deno.test("the report is written before the ledger, so a failed ledger write leaves the report", async () => {
  const w = world();
  await assert.rejects(
    main([], failingWrite(w, PATHS.ledger)),
    /no write access to tools\/eval\/spend\.json/,
  );
  assert.match(w.files.get(PATHS.report) ?? "", /\| Cheap \| 100\.0 \|/);
  assert.ok(
    w.printed.includes(
      "this run spent $0.0040; $0.0040 of $10.0000 spent in total",
    ),
    "the spend is printed before either write",
  );
});

Deno.test("a run keeps each image's reply in a folder named for its start, and the report names the folder", async () => {
  const w = world();
  assert.equal(await main([], io(w)), 0);
  const folder = "tools/eval/replies/2026-10-15T04-05-06Z";
  const kept = [...w.files.keys()].filter((path) =>
    path.startsWith("tools/eval/replies/")
  ).sort();
  assert.deepEqual(kept, [
    `${folder}/cheap/01-a.json`,
    `${folder}/cheap/02-b.json`,
    `${folder}/dear/01-a.json`,
    `${folder}/dear/02-b.json`,
  ]);
  const reply = JSON.parse(w.files.get(`${folder}/cheap/01-a.json`) ?? "");
  assert.equal(reply.candidate, "Cheap");
  assert.equal(reply.sample, "01-a");
  assert.equal(reply.outcome, "cards");
  assert.equal(reply.cards[0].front, "apple");
  assert.equal(reply.calls.length, 1);
  assert.equal(reply.calls[0].model, "vendor/cheap");
  assert.equal(reply.calls[0].status, 200);
  assert.equal(reply.calls[0].body.usage.cost, w.replyCost);
  assert.match(
    w.files.get(PATHS.report) ?? "",
    /Every reply, its parsed cards or its error body, is kept in `tools\/eval\/replies\/2026-10-15T04-05-06Z\/`/,
  );
});

Deno.test("a candidate stops after two model errors in a row, its error bodies kept, and one error then a reply does not stop it", async () => {
  const w = world(undefined, [
    { label: "Broken", primary: "^vendor/broken$" },
    { label: "Flaky", primary: "^vendor/flaky$" },
  ]);
  w.files.set(
    `${PATHS.samples}/03-c.json`,
    JSON.stringify({ image: "03-c.jpg", cards: truth }),
  );
  assert.equal(await main([], io(w)), 0);

  assert.deepEqual(w.chatCalls, [
    "vendor/broken",
    "vendor/broken",
    "vendor/flaky",
    "vendor/flaky",
    "vendor/flaky",
  ], "Broken ran two of the three images; control: Flaky ran all three");
  const folder = "tools/eval/replies/2026-10-15T04-05-06Z";
  const broken = JSON.parse(w.files.get(`${folder}/broken/02-b.json`) ?? "");
  assert.equal(broken.outcome, "model_error");
  assert.deepEqual(broken.calls, [{
    model: "vendor/broken",
    status: 400,
    body: ERROR_BODY,
  }]);
  assert.equal(w.files.get(`${folder}/broken/03-c.json`), undefined);
  assert.ok(
    w.printed.includes(
      "Broken: stopped after 2 model errors in a row, 2 of 3 images run",
    ),
  );
  const table = w.files.get(PATHS.report) ?? "";
  assert.match(
    table,
    /- Broken stopped after 2 model errors in a row: its row covers 2 of 3 images\./,
  );
  assert.doesNotMatch(table, /- Flaky stopped/);
  assert.equal(
    JSON.parse(w.files.get(PATHS.ledger) ?? "").runs.at(-1).spentUsd,
    2 * w.replyCost,
    "a failed call reports no usage and records no spend; control: Flaky's two replies do",
  );
});

Deno.test("a notes sample is scored by coverage, unsupported cards, invented examples and long answers, with no step order", async () => {
  const w = world(undefined, [{ label: "Cheap", primary: "^vendor/cheap$" }]);
  w.files.set(
    `${PATHS.samples}/03-notes.json`,
    JSON.stringify({ image: "03-notes.jpg", ...notesTruth }),
  );
  assert.equal(await main(["--dry-run"], io(w)), 0);
  assert.ok(
    w.printed.some((line) =>
      line.startsWith("3 samples (2 vocabulary, 1 notes)")
    ),
  );
  assert.equal(await main([], io(w)), 0);
  const table = w.files.get(PATHS.report) ?? "";
  // The one note card covers one of the page's two facts.
  assert.match(
    table,
    /\| Configuration \| Coverage \| Unsupported \| Invented examples \| Long answers \| Bare exceptions \| Table blanks \| Cloze blanks \|\n/,
  );
  // No page names table or cloze blanks, so both read as a dash.
  assert.match(
    table,
    /\| Cheap \| 50\.0 \| 0\.0 \| 0\.0 \| 0\.0 \| 0\.0 \| — \| — \|\n/,
  );
  assert.doesNotMatch(table, /Step order|Coverage at/);
  assert.match(table, /\| Cheap \| 100\.0 \| 50\.0 \| 66\.7 \|/);
});

Deno.test("the report gives each notes page's coverage, with the completion tokens of its calls", async () => {
  const w = world(undefined, [{ label: "Cheap", primary: "^vendor/cheap$" }]);
  w.files.set(
    `${PATHS.samples}/03-notes.json`,
    JSON.stringify({ image: "03-notes.jpg", ...notesTruth }),
  );
  // A page whose one rule is the deduction rule the note card states.
  w.files.set(
    `${PATHS.samples}/04-notes-dense.json`,
    JSON.stringify({
      image: "04-notes-dense.jpg",
      kind: "notes",
      facts: [notesTruth.facts[0]],
      lines: notesTruth.lines,
    }),
  );
  assert.equal(await main([], io(w)), 0);
  const table = w.files.get(PATHS.report) ?? "";
  assert.match(table, /## Coverage per notes page/);
  assert.match(table, /\| Page \| Cheap \|/);
  // Each call of the fake replies with 50 completion tokens.
  assert.match(table, /\| 03-notes \| 50\.0 · 50 tokens \|/);
  assert.match(table, /\| 04-notes-dense \| 100\.0 · 50 tokens \|/);
  assert.match(table, /against the function's `max_tokens` of 16384 per call/);
});

Deno.test("a vocabulary ground truth is read as senses of labels, meaning and examples, and a card of another shape is refused", async () => {
  const sense = { labels: [NOUN], meaning: "사과", examples: [] };
  for (
    const card of [
      { front: "apple", meaning: "사과", partOfSpeech: "n." },
      { front: "apple", senses: [{ pos: "n.", meaning: "사과" }] },
      { front: "apple", senses: [] },
      {
        front: "apple",
        senses: [{ ...sense, labels: [{ ...NOUN, category: null }] }],
      },
      { front: "apple", senses: [sense], extras: [{ label: "복수" }] },
      { front: "apple", senses: [sense], examples: [] },
    ]
  ) {
    const w = world();
    w.files.set(
      `${PATHS.samples}/01-a.json`,
      JSON.stringify({ image: "01-a.jpg", cards: [card] }),
    );
    await assert.rejects(
      loadSamples(io(w)),
      /holds a card that is not \{front, senses: \[\{labels, meaning, examples\}\], examples\?, extras\?\}/,
      JSON.stringify(card),
    );
  }
  const control = world();
  const card = {
    front: "apple",
    senses: [{ ...sense, labels: [{ ...NOUN, text: "[n.]" }] }],
    examples: ["She ate an apple."],
    extras: [{ label: "복수", text: "apples" }],
  };
  control.files.set(
    `${PATHS.samples}/01-a.json`,
    JSON.stringify({ image: "01-a.jpg", cards: [card] }),
  );
  const [sample] = await loadSamples(io(control));
  assert.ok(sample.kind === "vocabulary");
  assert.deepEqual(
    sample.cards[0],
    {
      ...card,
      senses: [sense],
    },
    "control: read as the function reads a sense, the label without its brackets",
  );
});

Deno.test("a notes ground truth without facts, with a step outside 1 to 5, with examples not of text, or without its lines, is refused", async () => {
  for (
    const facts of [
      [],
      [{ id: "a", step: 6, terms: ["x"] }],
      [{ id: "a", step: 1, terms: ["x"], examples: "x" }],
      [{ id: "a", step: 1, terms: ["x"], examples: [1] }],
    ]
  ) {
    const w = world();
    w.files.set(
      `${PATHS.samples}/03-notes.json`,
      JSON.stringify({ image: "03-notes.jpg", ...notesTruth, facts }),
    );
    await assert.rejects(loadSamples(io(w)), /notes ground truth/);
  }
  for (const lines of [undefined, [], [1]]) {
    const w = world();
    w.files.set(
      `${PATHS.samples}/03-notes.json`,
      JSON.stringify({ image: "03-notes.jpg", ...notesTruth, lines }),
    );
    await assert.rejects(
      loadSamples(io(w)),
      /notes ground truth of \{facts: \[\{id, step, terms, examples\?\}\], lines, tableBlanks\?: \[\{id, terms\}\], clozeBlanks\?: \[\{id, terms\}\]\}/,
    );
  }
  for (
    const blanks of [
      [],
      "x",
      [{ id: "a" }],
      [{ id: "a", terms: [] }],
      [{ id: "a", terms: [" "] }],
      [{ id: 1, terms: ["x"] }],
    ]
  ) {
    for (const key of ["tableBlanks", "clozeBlanks"]) {
      const w = world();
      w.files.set(
        `${PATHS.samples}/03-notes.json`,
        JSON.stringify({ image: "03-notes.jpg", ...notesTruth, [key]: blanks }),
      );
      await assert.rejects(
        loadSamples(io(w)),
        /notes ground truth/,
        `${key}: ${JSON.stringify(blanks)}`,
      );
    }
  }
  const control = world();
  control.files.set(
    `${PATHS.samples}/03-notes.json`,
    JSON.stringify({
      image: "03-notes.jpg",
      ...notesTruth,
      tableBlanks: [{ id: "a", terms: ["x"] }],
      clozeBlanks: [{ id: "b", terms: ["y", "z"] }],
    }),
  );
  const samples = await loadSamples(io(control));
  assert.equal(samples.length, 3);
  const notes = samples.find((sample) => sample.kind === "notes");
  assert.deepEqual(
    notes?.kind === "notes" &&
      [notes.notes.tableBlanks, notes.notes.clozeBlanks],
    [[{ id: "a", terms: ["x"] }], [{ id: "b", terms: ["y", "z"] }]],
  );
});

Deno.test("a notes page naming table and cloze blanks is scored on the blanks its table and cloze cards ask", async () => {
  const w = world(undefined, [{ label: "Cheap", primary: "^vendor/cheap$" }]);
  w.files.set(
    `${PATHS.samples}/03-notes.json`,
    JSON.stringify({
      image: "03-notes.jpg",
      ...notesTruth,
      tableBlanks: [
        { id: "native", terms: ["하나"] },
        { id: "sino", terms: ["일"] },
      ],
      clozeBlanks: [{ id: "deduction", terms: ["반드시"] }],
    }),
  );
  w.notesReply = [{
    ...noteCards[0],
    type: "table",
    front: "수사",
    answer: null,
    examples: [],
    table: {
      columns: ["구분", "고유어", "한자어"],
      rows: [["양수사", "하나", "일"]],
      blanks: [{ row: 0, column: 1 }],
    },
  }, {
    ...noteCards[0],
    type: "cloze",
    front: "연역 논증: 전제가 참이면 결론이 {{c1::반드시}} 참",
    answer: null,
    examples: [],
    cloze: { answers: ["반드시"] },
  }];
  assert.equal(await main([], io(w)), 0);
  const table = w.files.get(PATHS.report) ?? "";
  // One of the two table cells is a blank, and the one cloze word is.
  assert.match(
    table,
    /\| Cheap \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \| 50\.0 \| 100\.0 \|\n/,
  );
});

Deno.test("the dry estimate prices a note card above a vocabulary card", () => {
  const cheap = newest("^vendor/cheap$", parseModels(MODEL_LIST));
  assert.ok(cheap !== null);
  const candidate = [{ label: "Cheap", primary: cheap }];
  const vocabulary = estimateUsd(candidate, [{
    cards: 10,
    tokensPerCard: TYPICAL_VOCABULARY_TOKENS_PER_CARD,
  }]);
  const notes = estimateUsd(candidate, [{
    cards: 10,
    tokensPerCard: TYPICAL_NOTE_TOKENS_PER_CARD,
  }]);
  assert.ok(notes > vocabulary);
});

Deno.test("a run stops before a call whose worst case could exceed the remaining budget", async () => {
  const w = world();
  const samples = await loadSamples(io(w));
  const models = parseModels(MODEL_LIST);
  const cheap = newest("^vendor/cheap$", models);
  assert.ok(cheap !== null);
  // The function's way may read a photo on, so its worst case is that many calls'.
  const worst = worstCallUsd(cheap.pricing) * ALTERNATIVES[0].calls;
  // Room for the worst case of the first image, and not for it again once that image spent its reply cost.
  const ledger = { budgetUsd: worst + w.replyCost / 2, runs: [] };
  const run = await runEval(
    [{ label: "Cheap", primary: cheap }],
    samples,
    ledger,
    {
      apiKey: "key",
      prompt: { label: "v9", text: SYSTEM_PROMPT },
      alternative: ALTERNATIVES[0],
      fetch: io(w).fetch,
      now: () => 0,
      timeoutMs: 1000,
      print: () => {},
      keep: () => Promise.resolve(),
    },
  );
  assert.equal(run.stopped, true);
  assert.equal(
    w.chatCalls.length,
    1,
    "the first image ran, the second did not",
  );
  assert.ok(run.spentUsd <= ledger.budgetUsd);

  const roomy = await runEval(
    [{ label: "Cheap", primary: cheap }],
    samples,
    {
      budgetUsd: worst + 3 * w.replyCost,
      runs: [],
    },
    {
      apiKey: "key",
      prompt: { label: "v9", text: SYSTEM_PROMPT },
      alternative: ALTERNATIVES[0],
      fetch: io(world()).fetch,
      now: () => 0,
      timeoutMs: 1000,
      print: () => {},
      keep: () => Promise.resolve(),
    },
  );
  assert.equal(roomy.stopped, false, "control: room for both images");
});

Deno.test("a candidate matching no usable model stops the run before any call", async () => {
  const w = world(undefined, [{
    label: "Gone",
    primary: "^vendor/text-only$",
  }]);
  assert.equal(await main([], io(w)), 1);
  assert.equal(w.chatCalls.length, 0);
  assert.ok(w.printed[0].includes("Gone"));
});

Deno.test("a run without OPENROUTER_API_KEY stops before any call", async () => {
  const w = world();
  assert.equal(await main([], io(w, {})), 1);
  assert.equal(w.chatCalls.length, 0);
});

Deno.test("the committed sample set has at least 20 vocabulary images in every layout and language pair, with the fields each prints", async () => {
  const samples = await committedSamples();
  const vocabulary = samples.flatMap((sample) =>
    sample.kind === "vocabulary" ? [sample] : []
  );
  assert.ok(vocabulary.length >= 20, `${vocabulary.length} vocabulary samples`);
  for (const sample of samples) {
    assert.ok(
      atob(sample.image.base64.slice(0, 4)).startsWith("\xff\xd8\xff"),
      `${sample.name} is a JPEG`,
    );
  }
  for (const sample of vocabulary) {
    assert.ok(sample.cards.length > 0, `${sample.name} has cards`);
  }
  const dictionary = vocabulary.filter((s) =>
    /^\d+-dictionary-(en|ja)-ko-/.test(s.name)
  );
  const others = vocabulary.filter((s) =>
    /^\d+-(two-column|bilingual-table|glossary)-/.test(s.name)
  );
  assert.equal(dictionary.length, 6);
  assert.equal(others.length, 18);
  assert.ok(
    dictionary.every((s) =>
      s.cards.every((c) =>
        c.senses.length === 1 && c.senses[0].labels.length === 1 &&
        c.senses[0].labels[0].kind === "part_of_speech"
      )
    ),
    "every dictionary entry has the part of speech its page prints, with its category",
  );
  assert.ok(
    dictionary.some((s) =>
      s.cards.some((c) =>
        c.senses[0].labels[0].text === "동" &&
        c.senses[0].labels[0].category === "verb"
      )
    ),
    "a dictionary page prints [동], a verb, read without its brackets",
  );
  assert.ok(
    dictionary.some((s) => s.cards.some((c) => (c.examples ?? []).length > 0)),
    "a dictionary page prints examples",
  );
  assert.ok(
    others.every((s) =>
      s.cards.every((c) =>
        c.senses.every((sense) => sense.labels.length === 0) &&
        c.examples === undefined
      )
    ),
    "the other layouts print neither, so their truth holds neither",
  );
  for (
    const part of [
      "two-column",
      "bilingual-table",
      "dictionary",
      "glossary",
      "en-ko",
      "ja-ko",
      "handwriting",
    ]
  ) {
    assert.ok(
      vocabulary.some((sample) => sample.name.includes(part)),
      `a sample has ${part}`,
    );
  }
});

Deno.test("the committed numbered word lists, print and harsh, hold each word without its number, and a reply keeping the numbers is counted", async () => {
  const lists = (await committedSamples()).flatMap((sample) =>
    sample.kind === "vocabulary" && /-numbered-list-en-ko-/.test(sample.name)
      ? [sample]
      : []
  );
  assert.deepEqual(lists.map((list) => list.name), [
    "88-numbered-list-en-ko-print",
    "89-numbered-list-en-ko-harsh",
  ]);
  const words = JSON.parse(
    await Deno.readTextFile(new URL("./vocabulary.json", import.meta.url)),
  )["numbered-list"];
  for (const list of lists) {
    assert.deepEqual(
      list.cards.map((card) => [card.front, meaningOf(card.senses)]),
      words.map((word: { front: string; back: string }) => [
        word.front,
        word.back,
      ]),
      `${list.name} holds each word and its meaning`,
    );
    const numbered = score(
      list.cards.map((card, i) => ({
        ...card,
        front: `${i + 1}. ${card.front}`,
      })),
      list.cards,
    );
    assert.deepEqual(numbered.fronts, {
      returned: words.length,
      numbered: words.length,
    });
    assert.equal(numbered.f1, 0, "a numbered front matches no word");
    assert.deepEqual(
      score(list.cards, list.cards).fronts,
      { returned: words.length, numbered: 0 },
      "control: the truth's own fronts hold no number",
    );
  }
});

/** The notes document a committed notes sample was drawn from, named between "notes-" and its hand. */
function documentOf(name: string): string {
  return name.replace(/^\d+-notes-/, "").replace(
    /-(print|handwriting)-.*$/,
    "",
  );
}

Deno.test("the committed word-book samples give each entry its senses in page order, several with labels, and a pronunciation per part of speech", async () => {
  const books = (await committedSamples()).flatMap((sample) =>
    sample.kind === "vocabulary" && /-word-book-en-ko-/.test(sample.name)
      ? [sample]
      : []
  );
  assert.equal(books.length, 3, "print, handwriting and harsh");
  const vocabulary = JSON.parse(
    await Deno.readTextFile(new URL("./vocabulary.json", import.meta.url)),
  )["word-book"];
  for (const book of books) {
    assert.deepEqual(
      book.cards.map((card) =>
        card.senses.map((sense) => ({
          labels: sense.labels.map((label) => `[${label.text}]`),
          meaning: sense.meaning,
        }))
      ),
      vocabulary.map((entry: { senses: unknown }) => entry.senses),
      `${book.name} reads each entry's senses in order`,
    );
    const face = book.cards.find((card) => card.front === "face");
    assert.equal(
      face && meaningOf(face.senses),
      "직면하다, 마주하다; 표면, 겉면; 얼굴, 생김새",
    );
  }
  assert.ok(
    vocabulary.some((entry: { pronunciation: string }) =>
      entry.pronunciation.startsWith("명 ") &&
      entry.pronunciation.includes(" / ")
    ),
    "a pronunciation that varies by part of speech",
  );
});

Deno.test("the committed pages for prompt v8 print the word book without labels, an example under each sense, a Korean dictionary's classes and definitions, and German grammar as extras", async () => {
  const samples = (await committedSamples()).flatMap((sample) =>
    sample.kind === "vocabulary" ? [sample] : []
  );
  const pages = (name: string) =>
    samples.filter((sample) => new RegExp(`^\\d+-${name}-`).test(sample.name));
  const [book] = pages("word-book-en-ko");
  const unlabelled = pages("word-book-unlabelled-en-ko");
  assert.equal(unlabelled.length, 3, "print, handwriting and harsh");
  for (const page of unlabelled) {
    assert.deepEqual(
      page.cards.map((card) => card.senses.map((sense) => sense.meaning)),
      book.cards.map((card) => card.senses.map((sense) => sense.meaning)),
      `${page.name} holds the word book's senses, whose labelled pages are its control`,
    );
    assert.ok(
      page.cards.every((card) =>
        card.senses.every((sense) => sense.labels.length === 0)
      ),
      `${page.name} prints no label`,
    );
  }
  assert.ok(
    book.cards.every((card) =>
      card.senses.every((sense) => sense.labels.length === 1)
    ),
    "control: the word book labels every sense",
  );
  for (const page of pages("word-book-examples-en-ko")) {
    assert.ok(
      page.cards.every((card) =>
        card.senses.length >= 2 &&
        card.senses.every((sense) => sense.examples.length === 1) &&
        card.examples === undefined
      ),
      `${page.name} prints one example under each sense, none for the entry`,
    );
  }
  for (const page of pages("dictionary-ko")) {
    const train = page.cards.find((card) => card.front === "기차");
    assert.deepEqual(train?.senses, [{
      labels: [{ kind: "other", category: null, text: "사물" }],
      meaning: "철도 위를 다니는 긴 차",
      examples: [],
    }], `${page.name} prints 기차 with its class and definition`);
    assert.ok(
      page.cards.some((card) =>
        card.senses.some((sense) =>
          sense.labels.length === 2 &&
          sense.labels[0].category === "noun" &&
          sense.labels[0].text === "명사" && sense.labels[1].kind === "other"
        )
      ),
      `${page.name} prints a part of speech and a class on one sense`,
    );
  }
  for (const page of pages("word-book-de-ko")) {
    const table = page.cards.find((card) => card.front === "Tisch");
    assert.deepEqual(table?.extras, [
      { label: "성", text: "der" },
      { label: "복수", text: "die Tische" },
    ], `${page.name} prints Tisch's gender and plural as extras`);
    assert.ok(
      page.cards.every((card) =>
        card.senses.every((sense) =>
          sense.labels.every((label) => label.kind === "part_of_speech")
        )
      ),
      `${page.name} puts no gender among a sense's labels`,
    );
  }
  assert.deepEqual(
    [
      "word-book-examples-en-ko",
      "dictionary-ko",
      "word-book-de-ko",
    ].map((name) => pages(name).length),
    [3, 3, 3],
  );
});

Deno.test("the committed notes samples cover Korean and English, print and handwriting, each step from 1 to 4, and only terms and examples their page prints", async () => {
  // The pages of `notes.json`; the two-stage eval's pages of `structure.json` are tested apart.
  const notes = (await committedSamples()).flatMap((sample) =>
    sample.kind === "notes" && !sample.name.includes("-structure-")
      ? [sample]
      : []
  );
  assert.equal(notes.length, 28);
  const documents = JSON.parse(
    await Deno.readTextFile(new URL("./notes.json", import.meta.url)),
  );
  for (
    const document of [
      "ko",
      "en",
      "ko-grammar",
      "ko-auxiliary",
      "ko-numerals",
      "ko-honorifics",
      "ko-components",
    ]
  ) {
    const drawn = notes.filter((sample) =>
      documentOf(sample.name) === document
    );
    for (const part of ["print", "handwriting", "mild", "harsh"]) {
      assert.equal(
        drawn.filter((sample) => sample.name.includes(part)).length,
        2,
        `${document} ${part}`,
      );
    }
  }
  for (const sample of notes) {
    const page = normalize(
      documents[documentOf(sample.name)].lines.map((line: { text: string }) =>
        line.text
      ).join("\n"),
    );
    for (const step of [1, 2, 3, 4]) {
      assert.ok(
        sample.notes.facts.some((fact) => fact.step === step),
        `${sample.name} has a fact at step ${step}`,
      );
    }
    for (const fact of sample.notes.facts) {
      for (const term of fact.terms) {
        assert.ok(
          page.includes(normalize(term)),
          `${sample.name}: ${fact.id}'s term ${term} is on the page`,
        );
      }
    }
    for (const example of sample.notes.facts.flatMap((fact) => fact.examples)) {
      assert.ok(page.includes(normalize(example)), `${example} is printed`);
    }
    assert.deepEqual(
      sample.notes.lines,
      [
        documents[documentOf(sample.name)].title,
        ...documents[documentOf(sample.name)].lines.map((
          line: { text: string },
        ) => line.text),
      ],
      `${sample.name} holds every line its page prints`,
    );
  }
});

Deno.test("the page for prompt v6 has a classification table, judgment rules, starred handwritten tips and a side box, and its truth makes each table cell a fact", async () => {
  const documents = JSON.parse(
    await Deno.readTextFile(new URL("./notes.json", import.meta.url)),
  );
  type Line = { text: string; kind: string; mark?: string; hand?: boolean };
  const page = documents["ko-numerals"];
  const lines: Line[] = page.lines;
  const rows = lines.filter((line) => line.kind === "row");
  assert.ok(rows.length >= 3, "a table of a header and rows");
  assert.ok(
    lines.some((line) => line.text.startsWith("구별:")),
    "a judgment rule",
  );
  assert.equal(
    lines.filter((line) => line.hand && line.mark === "star").length,
    2,
    "two starred handwritten tips",
  );
  assert.equal(lines.filter((line) => line.kind === "box").length, 1);
  // Every body cell of the table is covered by a fact of its own: the fact's terms hold its row
  // name and every item of the cell, or, for a cell whose items are single syllables, one of
  // them with the row name and the column name.
  type Fact = { id: string; terms: string[] };
  const facts: Fact[] = page.facts;
  const [, ...body] = rows.map((row) => row.text.split(" | "));
  const columns = rows[0].text.split(" | ");
  for (const [name, ...cells] of body) {
    cells.forEach((cell, i) => {
      const owners = facts.filter((fact) =>
        fact.terms.includes(name) &&
        (cell.split(", ").every((item) => fact.terms.includes(item)) ||
          (fact.terms.includes(columns[i + 1]) &&
            cell.split(", ").some((item) => fact.terms.includes(item))))
      );
      assert.equal(owners.length, 1, `${name} ${columns[i + 1]}: ${cell}`);
    });
  }
});

Deno.test("the pages for prompt v7 name the cells of a table to blank and the words of list lines to blank, each a cell or word the page prints, and their samples carry them", async () => {
  const documents = JSON.parse(
    await Deno.readTextFile(new URL("./notes.json", import.meta.url)),
  );
  type Line = { text: string; kind: string; header?: boolean };
  type Blank = { id: string; terms: string[] };
  const table = documents["ko-honorifics"];
  const rows: Line[] = table.lines.filter((line: Line) => line.kind === "row");
  assert.ok(rows[0].header, "a header row");
  const body = rows.slice(1).map((row) => row.text.split(" | "));
  const headers = [
    ...rows[0].text.split(" | "),
    ...body.map(([name]) => name),
  ];
  // Every table blank is one body cell, never a header, and every body cell but the row names
  // is a blank.
  const blanks: Blank[] = table.tableBlanks;
  for (const blank of blanks) {
    const cells = body.flatMap(([, ...cells]) => cells).filter((cell) =>
      blank.terms.every((term) => normalize(cell).includes(normalize(term)))
    );
    assert.equal(cells.length, 1, `${blank.id} is one body cell`);
    assert.ok(
      headers.every((header) =>
        !blank.terms.every((term) => normalize(header).includes(term))
      ),
      `${blank.id} is no header`,
    );
  }
  assert.equal(
    blanks.length,
    body.length * (rows[0].text.split(" | ").length - 1),
  );
  assert.equal(table.clozeBlanks, undefined);
  // The list page names each listed word of its first section as a cloze blank.
  const list = documents["ko-components"];
  const listed = list.lines.filter((line: Line) => line.kind === "point")
    .slice(0, 3)
    .flatMap((line: Line) => line.text.split(": ")[1].split(", "));
  assert.deepEqual(
    list.clozeBlanks.map((blank: Blank) => blank.terms.join()),
    listed,
  );
  assert.equal(list.tableBlanks, undefined);
  for (const name of ["ko-honorifics", "ko-components"]) {
    const samples = (await committedSamples()).filter((sample) =>
      sample.kind === "notes" && documentOf(sample.name) === name
    );
    assert.equal(samples.length, 4, name);
    for (const sample of samples) {
      assert.ok(sample.kind === "notes");
      assert.deepEqual(sample.notes.tableBlanks, documents[name].tableBlanks);
      assert.deepEqual(sample.notes.clozeBlanks, documents[name].clozeBlanks);
    }
  }
});

Deno.test("the committed notes pages count rules and exceptions as facts, each worked example an example of its rule's fact, and the dense page marks its exceptions", async () => {
  const documents = JSON.parse(
    await Deno.readTextFile(new URL("./notes.json", import.meta.url)),
  );
  const dense = documents["ko-grammar"];
  const sparse = documents["ko"];
  type Line = { text: string; kind: string; mark?: string };
  type Fact = {
    id: string;
    step: number;
    terms: string[];
    examples?: string[];
  };
  // Control: the earlier Korean page marks nothing and teaches 10 rules.
  assert.equal(sparse.lines.filter((line: Line) => line.mark).length, 0);
  assert.equal(sparse.facts.length, 10);
  assert.ok(dense.facts.length >= 2 * sparse.facts.length, "dense");
  const marked = dense.lines.filter((line: Line) => line.mark);
  assert.deepEqual(
    [...new Set(marked.map((line: Line) => line.mark))].sort(),
    ["circle", "star"],
  );
  // Every marked line is covered by a fact of its own terms.
  for (const line of marked) {
    const text = normalize(line.text);
    assert.ok(
      dense.facts.some((fact: Fact) =>
        fact.terms.every((term) => text.includes(normalize(term)))
      ),
      `a fact for: ${line.text}`,
    );
  }
  for (
    const name of [
      "ko",
      "en",
      "ko-grammar",
      "ko-auxiliary",
      "ko-honorifics",
      "ko-components",
    ]
  ) {
    const document = documents[name];
    // No fact is a worked example: none is named as one.
    assert.ok(
      document.facts.every((fact: Fact) => !fact.id.endsWith("-example")),
      `${name} has no worked-example fact`,
    );
    // Every example line belongs to the examples of exactly one fact.
    for (
      const line of document.lines.filter((line: Line) =>
        line.kind === "example"
      )
    ) {
      const owners = document.facts.filter((fact: Fact) =>
        (fact.examples ?? []).some((example) =>
          normalize(line.text).includes(normalize(example))
        )
      );
      assert.equal(owners.length, 1, `${name}: one rule owns ${line.text}`);
    }
  }
  const samples = (await committedSamples()).filter((sample) =>
    sample.name.includes("-ko-grammar-")
  );
  assert.equal(samples.length, 4);
  for (const sample of samples) {
    assert.ok(sample.kind === "notes");
    assert.equal(sample.notes.facts.length, dense.facts.length);
  }
});

Deno.test("the committed page with the writer's additions holds a classification table, a definition with printed examples, and pen additions, and its truth makes each list one card", async () => {
  const documents = JSON.parse(
    await Deno.readTextFile(new URL("./notes.json", import.meta.url)),
  );
  const page = documents["ko-auxiliary"];
  type Line = {
    text: string;
    kind: string;
    mark?: string;
    hand?: boolean;
    header?: boolean;
  };
  type Fact = { id: string; terms: string[]; examples?: string[] };
  const lines: Line[] = page.lines;
  const rows = lines.filter((line) => line.kind === "row");
  assert.ok(rows[0].header, "the table opens with a header row");
  assert.ok(rows.length >= 4, "a header and at least three kinds");
  assert.ok(rows.every((row) => row.text.split(" | ").length === 3));
  const definition = lines.findIndex((line) =>
    line.kind === "point" && !line.hand
  );
  assert.equal(
    lines[definition + 1].kind,
    "example",
    "the definition with its printed examples",
  );
  const starred = lines.filter((line) => line.hand && line.mark === "star");
  assert.equal(starred.length, 1, "a starred list added in pen");
  const methods = lines.filter((line) =>
    line.hand && /^[12]\) /.test(line.text)
  );
  assert.equal(methods.length, 2, "numbered judgment methods added in pen");
  const aside = lines.findIndex((line) => line.kind === "aside");
  assert.equal(lines[aside - 1].kind, "heading", "a rule beside a heading");
  // Control: the earlier pages have no table and no pen additions.
  for (const name of ["ko", "en", "ko-grammar"]) {
    assert.ok(
      documents[name].lines.every((line: Line) =>
        line.kind !== "row" && line.kind !== "aside" && !line.hand
      ),
      name,
    );
  }

  const facts: Fact[] = page.facts;
  const fact = (id: string) => {
    const found = facts.find((fact) => fact.id === id);
    assert.ok(found, id);
    return found;
  };
  const holds = (line: string, terms: string[]) =>
    terms.every((term) => normalize(line).includes(normalize(term)));
  // The definition, with its printed examples.
  assert.deepEqual(fact("definition").examples, [
    lines[definition + 1].text.replace(/^예\) /, ""),
  ]);
  // The starred list as one card: every member a term of one fact.
  assert.ok(holds(starred[0].text, fact("always-auxiliary").terms));
  assert.equal(fact("always-auxiliary").terms.length, 4);
  // A table row's list as one card.
  assert.ok(
    rows.some((row) => holds(row.text, fact("auxiliary-verbs").terms)),
  );
  // Both judgment methods as one card.
  const judgment = fact("judgment").terms;
  assert.ok(
    methods.every((method) =>
      judgment.some((term) => holds(method.text, [term]))
    ),
  );
  // The rule beside the heading.
  assert.ok(holds(lines[aside].text, fact("spacing-rule").terms));
});

/** The committed samples, read from `tools/eval/samples/`. */
async function committedSamples() {
  const dir = new URL("./samples/", import.meta.url);
  const names = (await Array.fromAsync(Deno.readDir(dir))).map((entry) =>
    entry.name
  );
  return await loadSamples({
    list: () => Promise.resolve(names),
    readText: (path) =>
      Deno.readTextFile(new URL(path.slice(PATHS.samples.length + 1), dir)),
    readBytes: (path) =>
      Deno.readFile(new URL(path.slice(PATHS.samples.length + 1), dir)),
  });
}

/** [w]'s I/O with the project's URL and key, whose database holds version 5 and no other. */
function withStore(w: World, systems: string[]): Io {
  const base = io(w, {
    OPENROUTER_API_KEY: "key",
    SUPABASE_URL: "https://project.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return {
    ...base,
    fetch: (input, init) => {
      const url = String(input);
      if (url === "https://project.supabase.test/rest/v1/rpc/prompt_version") {
        const asked = JSON.parse(String(init?.body)).version_id;
        const key = new Headers(init?.headers).get("Authorization");
        return Promise.resolve(Response.json(
          asked === 5 && key === "Bearer service-key"
            ? [{ text: "Stored instructions.", note: "shorter" }]
            : [],
        ));
      }
      if (url === OPENROUTER_URL) {
        systems.push(JSON.parse(String(init?.body)).messages[0].content);
      }
      return base.fetch(input, init);
    },
  };
}

Deno.test("--prompt-version runs a version read from the database, which the ledger and the report name", async () => {
  const w = world({ budgetUsd: 10, runs: [] });
  const systems: string[] = [];
  assert.equal(await main(["--prompt-version", "5"], withStore(w, systems)), 0);
  assert.ok(systems.length > 0);
  assert.ok(
    systems.every((system) =>
      system === composeInstructions("Stored instructions.")
    ),
  );
  assert.equal(
    JSON.parse(w.files.get(PATHS.ledger) ?? "").runs.at(-1).note,
    "prompt version 5",
  );
  assert.match(w.files.get(PATHS.report) ?? "", /with prompt version 5, over/);

  // Control: without the flag, the run gives prompt v10.
  const plain: string[] = [];
  assert.equal(
    await main([], withStore(world({ budgetUsd: 10, runs: [] }), plain)),
    0,
  );
  assert.ok(plain.length > 0);
  assert.ok(
    plain.every((system) => system === composeInstructions(SYSTEM_PROMPT)),
  );
});

Deno.test("--prompt-version refuses a missing or malformed id, an unknown version, or no project key, before any call", async () => {
  for (
    const args of [["--prompt-version"], ["--prompt-version", "x"], [
      "--prompt-version",
      "6",
    ]]
  ) {
    const w = world({ budgetUsd: 10, runs: [] });
    assert.equal(await main(args, withStore(w, [])), 1, args.join(" "));
    assert.equal(w.chatCalls.length, 0);
  }
  const w = world({ budgetUsd: 10, runs: [] });
  assert.equal(await main(["--prompt-version", "5"], io(w)), 1);
  assert.ok(
    w.printed.includes(
      "--prompt-version needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    ),
  );
  assert.equal(w.chatCalls.length, 0);
});

Deno.test("--prompts v9,v10 runs each prompt file on every configuration, each a row of its own, instructed as the function instructs it", async () => {
  const w = world({ budgetUsd: 10, runs: [] });
  w.systems = [];
  assert.equal(await main(["--prompts", "v9,v10"], io(w)), 0);
  assert.deepEqual(w.chatCalls, [
    "vendor/cheap",
    "vendor/cheap",
    "vendor/dear",
    "vendor/dear",
    "vendor/cheap",
    "vendor/cheap",
    "vendor/dear",
    "vendor/dear",
  ]);
  assert.deepEqual(w.systems, [
    ...Array(4).fill(composeInstructions(v9.SYSTEM_PROMPT)),
    ...Array(4).fill(composeInstructions(SYSTEM_PROMPT)),
  ]);
  const report = w.files.get(PATHS.report) ?? "";
  for (const label of ["Cheap, prompt v9", "Dear, prompt v10"]) {
    assert.match(report, new RegExp(`\\| ${label} \\| 100\\.0 \\|`), label);
  }
  assert.match(report, /with prompt v9 and v10, over/);
  assert.equal(
    JSON.parse(w.files.get(PATHS.ledger) ?? "").runs.at(-1).note,
    "prompt v9 and v10",
  );

  // The estimate covers both prompts: twice one prompt's, rounded apart.
  const estimate = (args: string[]) => {
    const dry = world();
    return main([...args, "--dry-run"], io(dry, {})).then(() =>
      Number(
        dry.printed.find((line) => line.includes("estimated"))
          ?.match(/estimated \$([\d.]+)/)?.[1],
      )
    );
  };
  const one = await estimate([]);
  assert.ok(one > 0);
  const two = await estimate(["--prompts", "v9,v10"]);
  // Each is printed to four decimals.
  assert.ok(Math.abs(two - one * 2) <= 0.0001, `${two} against ${one}`);
});

Deno.test("the committed dense word list holds its hundred French words, each with every meaning it prints as a sense", async () => {
  const dense = (await committedSamples()).find((sample) =>
    sample.name === "90-dense-list-fr-ko-print"
  );
  assert.ok(dense !== undefined && dense.kind === "vocabulary");
  const words: { front: string; senses: string[] }[] = JSON.parse(
    await Deno.readTextFile(new URL("./vocabulary.json", import.meta.url)),
  )["dense-list-fr"];
  assert.equal(dense.cards.length, 100);
  assert.deepEqual(
    dense.cards.map((card) => [
      card.front,
      card.senses.map((sense) => sense.meaning),
    ]),
    words.map((word) => [word.front, word.senses]),
  );
  assert.equal(
    dense.cards.filter((card) => card.senses.length === 2).length,
    15,
  );
  assert.deepEqual(dense.languages, { front: "fr", back: "ko" });
});

Deno.test("the committed two-hundred-word list holds a hundred new French words before the dense list's hundred, numbered from 1", async () => {
  const samples = await committedSamples();
  const long = samples.find((sample) =>
    sample.name === "91-dense-list-200-fr-ko-print"
  );
  assert.ok(long !== undefined && long.kind === "vocabulary");
  const vocabulary: Record<string, { front: string; senses: string[] }[]> = JSON
    .parse(
      await Deno.readTextFile(new URL("./vocabulary.json", import.meta.url)),
    );
  const words = [
    ...vocabulary["dense-list-fr-first"],
    ...vocabulary["dense-list-fr"],
  ];
  assert.equal(long.cards.length, 200);
  assert.deepEqual(
    long.cards.map((card) => [
      card.front,
      card.senses.map((sense) => sense.meaning),
    ]),
    words.map((word) => [word.front, word.senses]),
  );
  assert.equal(new Set(words.map((word) => word.front)).size, 200);
  assert.equal(
    long.cards.filter((card) => card.senses.length === 2).length,
    30,
  );
  assert.deepEqual(long.languages, { front: "fr", back: "ko" });
});

Deno.test("--alternatives runs each named way as rows of its own, and --samples runs only the samples named", async () => {
  const w = world({ budgetUsd: 10, runs: [] });
  w.systems = [];
  assert.equal(
    await main(["--alternatives", "today,lean", "--samples", "01"], io(w)),
    0,
  );
  assert.deepEqual(w.chatCalls, [
    "vendor/cheap",
    "vendor/dear",
    "vendor/cheap",
    "vendor/dear",
  ]);
  assert.deepEqual(w.systems, [
    ...Array(2).fill(composeInstructions(SYSTEM_PROMPT)),
    ...Array(2).fill(composeInstructions(SYSTEM_PROMPT, LEAN_CONTRACT)),
  ]);
  const report = w.files.get(PATHS.report) ?? "";
  for (const label of ["Cheap, today", "Dear, lean"]) {
    assert.match(report, new RegExp(`\\| ${label} \\| 1 \\| `), label);
  }
  assert.equal(
    JSON.parse(w.files.get(PATHS.ledger) ?? "").runs.at(-1).note,
    "prompt v10, today, lean",
  );
  // An unknown or repeated way, or a sample number that names none, is refused before any call.
  for (
    const args of [
      ["--alternatives", "lean,lean"],
      ["--alternatives", "wide"],
      ["--samples", "03"],
    ]
  ) {
    const refused = world({ budgetUsd: 10, runs: [] });
    assert.equal(await main(args, io(refused)), 1, args.join(" "));
    assert.equal(refused.chatCalls.length, 0, args.join(" "));
  }
  // Control: without either flag, every sample runs the function's own call alone.
  const plain = world({ budgetUsd: 10, runs: [] });
  assert.equal(await main([], io(plain)), 0);
  assert.equal(plain.chatCalls.length, 4);
});

Deno.test("--prompts refuses an unknown or repeated file, or --prompt-version beside it, before any call", async () => {
  for (
    const args of [
      ["--prompts", "v8"],
      ["--prompts", "v10,v10"],
      ["--prompts"],
      ["--prompts", "v10", "--prompt-version", "5"],
    ]
  ) {
    const w = world({ budgetUsd: 10, runs: [] });
    assert.equal(await main(args, io(w)), 1, args.join(" "));
    assert.equal(w.chatCalls.length, 0, args.join(" "));
  }
  // Control: one known file runs.
  const w = world({ budgetUsd: 10, runs: [] });
  assert.equal(await main(["--prompts", "v10"], io(w)), 0);
  assert.equal(w.chatCalls.length, 4);
});

Deno.test("a reply's cards that break a rule are dropped, kept by rule in its reply and counted in the report beside invalid outputs", async () => {
  const w = world();
  // apple with an answer breaks a rule; river is valid.
  w.vocabularyReply = [{ ...modelCards[0], answer: "사과" }, modelCards[1]];
  assert.equal(await main([], io(w)), 0);
  const folder = "tools/eval/replies/2026-10-15T04-05-06Z";
  const reply = JSON.parse(w.files.get(`${folder}/cheap/01-a.json`) ?? "");
  assert.equal(reply.outcome, "cards");
  assert.deepEqual(reply.cards.map((card: { front: string }) => card.front), [
    "river",
  ]);
  assert.deepEqual(reply.dropped, ["vocabulary_answer"]);
  const report = w.files.get(PATHS.report) ?? "";
  assert.match(
    report,
    /\| Cheap \| 2 \| 2 \| 0 \| 0 \| 0 \| 2 \| `vocabulary_answer` 2 \|/,
  );

  // A reply whose every card breaks a rule is an invalid output.
  const broken = world();
  broken.vocabularyReply = [{ ...modelCards[0], answer: "사과" }];
  assert.equal(await main([], io(broken)), 0);
  assert.equal(
    JSON.parse(broken.files.get(`${folder}/dear/02-b.json`) ?? "").outcome,
    "invalid_output",
  );
  assert.match(
    broken.files.get(PATHS.report) ?? "",
    /\| Dear \| 2 \| 0 \| 0 \| 2 \| 0 \| 2 \| `vocabulary_answer` 2 \|/,
  );

  // Control: valid replies drop none.
  const valid = world();
  assert.equal(await main([], io(valid)), 0);
  assert.match(
    valid.files.get(PATHS.report) ?? "",
    /\| Cheap \| 2 \| 2 \| 0 \| 0 \| 0 \| 0 \| — \|/,
  );
});

Deno.test("a call that never answers is a model error at the timeout, kept and reported as one, and the run goes on", async () => {
  const w = world();
  w.hangs = 1;
  const cheap = newest("^vendor/cheap$", parseModels(MODEL_LIST));
  assert.ok(cheap !== null);
  const samples = await loadSamples(io(w));
  const kept = new Map<string, unknown>();
  const printed: string[] = [];
  const run = await runEval(
    [{ label: "Cheap", primary: cheap }],
    samples,
    { budgetUsd: 10, runs: [] },
    {
      apiKey: "key",
      prompt: { label: "v10", text: SYSTEM_PROMPT },
      alternative: ALTERNATIVES[0],
      fetch: io(w).fetch,
      now: () => 0,
      timeoutMs: 20,
      print: (line) => printed.push(line),
      keep: (path, reply) => {
        kept.set(path, reply);
        return Promise.resolve();
      },
    },
  );
  assert.equal(run.stopped, false);
  assert.equal(w.chatCalls.length, 2, "the second image still ran");
  assert.deepEqual(run.outcomes[0].modelErrors, 1);
  assert.deepEqual(
    run.halted,
    [],
    "one model error does not stop the candidate",
  );
  assert.ok(
    printed.includes(
      "Cheap 01-a: model_error, timed out after 20 ms, 0 cards, $0.0000",
    ),
    printed.join("\n"),
  );
  const first = kept.get("cheap/01-a.json") as {
    outcome: string;
    calls: { error?: string }[];
  };
  assert.equal(first.outcome, "model_error");
  assert.deepEqual(first.calls[0].error, "timed out after 20 ms");
  // Control: the image after it was answered.
  assert.equal(
    (kept.get("cheap/02-b.json") as { outcome: string }).outcome,
    "cards",
  );
});
