/**
 * The two-stage photo import prototype (#414): stage 1 reads a photo's sections, stage 2 makes
 * each section's card shapes from its JSON and the same photo, and a text-only judge reads the
 * sentences stage 2 composed. Every stage-1 and stage-2 call shares one system prompt and the photo
 * ahead of a cache breakpoint, and sends the reply schema of its own step: stage 1's sections, or
 * its one shape, each kept small for the provider's grammar limit. A schema the provider still
 * refuses as too large is sent as plain JSON instead, checked by its parser.
 */

import type { Card } from "../../supabase/functions/extract-cards/cards.ts";
import {
  type Attempt,
  extractCards,
  MAX_OUTPUT_TOKENS,
  MODEL_TIMEOUT_MS,
  type Usage,
} from "../../supabase/functions/extract-cards/model.ts";
import { OPENROUTER_URL } from "../../supabase/functions/extract-cards/providers.ts";
import type {
  Image,
  LanguageHints,
} from "../../supabase/functions/extract-cards/request.ts";
import { callUsd, worstCallUsd } from "./budget.ts";
import { entryOf, score, scoreNotes } from "./metrics.ts";
import type { Model } from "./models.ts";
import { type Call, recording, type Sample } from "./run.ts";
import {
  flatOf,
  hasOnlyKeys,
  isRecord,
  type Line,
  linesOf,
  list,
  parseSections,
  type Section,
  sectionsSchema,
  TABLE_CONTENT,
  type TruthLine,
} from "./sections.ts";
import {
  cardsOf,
  composedOf,
  type LineBlank,
  lineBlanksOf,
  parseShape,
  type Shape,
  type ShapeOutput,
  SHAPES,
  shapeSchemas,
  shapesFor,
} from "./shapes.ts";
import {
  type PageResult,
  scoreMarks,
  scoreSpans,
  scoreStructure,
} from "./two_stage_metrics.ts";

/** The instructions of every stage-1 and stage-2 call; the user turn says which to do. */
export const TWO_STAGE_PROMPT =
  `You read a photo of a study page and turn it into flashcards in two stages. Every request carries the same photo; its text says which stage to do. Answer with JSON only, matching the given schema: the one reply the request asks for.

Stage 1, when the request says "Return the page's sections": transcribe the page into sections, in reading order, as {"kind": "sections", "sections": [...]}.
- A section is a part of the page under one heading, or one block of it: its title as printed, or a short name for a block without one; its language as a BCP 47 tag such as "ko" or "en"; and its content_type: vocabulary_list (words with their meanings), comparison_table (a table comparing several items over the same aspects), table (any other table), rule_list (rules, definitions or facts listed), process (ordered steps), worked_examples (examples worked through), or prose.
- A comparison_table or table section gives its columns, the headers of the columns that hold cells, left to right, leaving out the column that names the rows, and its rows, the text of that first column, top to bottom. Each of its lines names the cell it is in by row and column, each counted from 0, the lines of one cell in the cell's order. Every other section gives no columns and no rows, and its lines row -1 and column -1.
- A line is one printed line or bullet point, its text character for character as the page shows it, without the bullet; a bullet point wrapped onto a second row is still one line. Give each line an id unique on the page, such as "s1-l3" or "s1-r2-c1-l1".
- role: "fact" for a line that states something to recall, with any label before its colon and any example on the same line; "example" for a line that only gives examples of the fact before it, such as one beginning "예)" or "e.g."; "heading" for a line that only names what follows, such as the page's title. A section's own heading is its title, not one of its lines.
- marks: each mark on the line, underline, circle, highlight or star, its ink "pen" where a writer added it by hand and "print" where the page printed it, and its text, the words it covers copied character for character from the line's text. A star, or a mark on the whole line, gives the line's whole text.
- key_terms: the words of the line a learner should recall, each its text copied character for character from the line's text, source "mark" for each text a pen underline, circle or highlight covers, every one of which is a key term, and source "model" for each you chose yourself. A label before a colon, such as "ㅡ 탈락" in "ㅡ 탈락: 어간 끝 'ㅡ'는 떨어진다", is a key term.
- Transcribe only what is printed or written. Never add, complete, translate or correct.

Stage 2, when the request says "Return the shape <shape> for this section": the request gives one section of stage 1 as JSON. Return only that shape, as {"kind": "<shape>", ...}, made from that section and the photo:
- table_cells: the table kept whole, with the cells to recall as its blanks, each {row, column}, row counting the section's rows from 0 and column its columns from 0, the column of row headers not counted: the row and column the section's lines give. Blank each cell holding a line with key terms, or, where no line holds one, each cell holding a fact to recall. Give at least one cell, each cell once, and never a cell no line of the section is in, whatever the photo shows.
- table_spans: the table kept whole, with blanks inside its cells, each {line_id, text}, text a run of one cell line's text copied exactly: its key terms first. One cell may hold several blanks; two blanks never overlap.
- qa: one question for each cell that holds lines, each {row, column, question, composed}, asking the row's aspect of the column's item, such as "부여의 정치 체제는?" for the cell of row 정치 under 부여. The cell's lines are its answer.
- cloze: one sentence for each line of role "fact" and for no other line or text, each {line_id, sentence, blanks, composed}, stating the line's fact with blanks. An example or heading line gets no sentence. Each blank is the text it hides, copied exactly from the sentence, the blanks in the order the sentence holds them. Blank the line's key terms, or, for a line with none, the word or phrase that carries its fact: every sentence holds at least one blank.
- A cloze sentence keeps every term its line prints, word for word, a label before its colon included; it never replaces a term with another word. Keep the line's own wording when it reads as a sentence on its own and names what it is about. Otherwise write one sentence that names what the line is about, from the line's label, its cell's row and column, or else the section's title: "부여는 5부족 연맹체였다." with the blank "5부족 연맹체" for the line "5부족 연맹체" in the cell of row 정치 under 부여, and "축약에서 ㅗ+ㅏ는 ㅘ가 된다: 보+아라 -> 봐라" with the blank "ㅘ" for the line "ㅗ+ㅏ -> ㅘ: 보+아라 -> 봐라" in the section "3. 축약".
- vocabulary: the section's entries as vocabulary cards, one for each headword: kind "vocabulary", type "concept", front the headword as printed, answer null, topic the section's title, senses in the page's order, each with the labels printed for it (a part of speech with its category, any other label with category null), its meaning, and the examples printed under it; extras, pronunciation and examples as the page prints them, and otherwise empty lists or null; table and cloze null.
- composed is true for any question or sentence whose wording is not printed on the page, and false only for a sentence that is its line word for word.
- Never state a fact, name, number or example the section does not hold.`;

/** What the judge is asked: whether each composed sentence states only what the page prints. */
export const JUDGE_PROMPT =
  `You check flashcard sentences against the text of the study page they were made from. For each numbered sentence, answer supported true when everything it states, every fact, name, number and relation, is stated or directly implied by the page's lines, and false when it states anything the page does not, or misattributes a fact to another item. A question is supported when what it presupposes is on the page. Answer with JSON only, matching the given schema, one verdict for every sentence, in order.`;

/** A reply schema as a call sends it, named. */
export type Format = { readonly name: string; readonly schema: unknown };

/** Stage 1's reply format. */
export const SECTIONS_FORMAT: Format = {
  name: "sections",
  schema: sectionsSchema,
};

/** Stage 2's reply format for [shape], named for it. */
export function shapeFormat(shape: Shape): Format {
  return { name: shape, schema: shapeSchemas[shape] };
}

/** How the provider words its refusal of a schema whose compiled grammar is over its limit. */
export const GRAMMAR_TOO_LARGE = /grammar is too large/i;

export const judgeSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          supported: { type: "boolean" },
        },
        required: ["id", "supported"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

/** A configuration: today's single call, or stage 1 and stage 2 on their own models. */
export type Configuration =
  | { readonly label: string; readonly kind: "single"; readonly model: Model }
  | {
    readonly label: string;
    readonly kind: "two_stage";
    readonly sections: Model;
    readonly shapes: Model;
  };

/** The run's spend so far against what the budget leaves; a call that may not fit is refused. */
export class Wallet {
  #spent = 0;
  constructor(readonly left: number) {}
  get spent(): number {
    return this.#spent;
  }
  /** Whether a call whose worst case is [usd] still fits. */
  fits(usd: number): boolean {
    return this.#spent + usd <= this.left;
  }
  spend(usd: number): void {
    this.#spent += usd;
  }
}

/** A call refused because its worst case could exceed what the budget leaves. */
export class OutOfBudget extends Error {}

export type TwoStageDeps = {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly wallet: Wallet;
  /** The judge's model, text only. */
  readonly judge: Model;
  /** The instructions of today's single call. */
  readonly singlePrompt: string;
  /**
   * The formats, by `looseKey`, the provider refused as too large a grammar: from then on in the
   * run they are asked as plain JSON.
   */
  readonly loose: Set<string>;
};

/** The key of [format] on [model] in `TwoStageDeps.loose`, as the run reports it. */
export function looseKey(model: Model, format: Format): string {
  return `${format.name} on ${model.id}`;
}

/**
 * One call as kept: what it asked for, its model, whether its reply was held to its schema by
 * strict structured outputs, and its HTTP status and body or its error.
 */
export type KeptCall =
  & {
    readonly step: "single" | "sections" | "shape" | "judge";
    readonly section?: string;
    readonly shape?: Shape;
    readonly model: string;
    readonly strict: boolean;
  }
  & Call;

/** One page's outcome: its scores, the calls kept, and whether stage 1's call failed. */
export type PageRun = {
  readonly result: PageResult;
  readonly calls: readonly KeptCall[];
  readonly cards: readonly unknown[];
  /** Each composed sentence, with the judge's verdict, or null where it gave none. */
  readonly composed: readonly {
    readonly sentence: string;
    readonly supported: boolean | null;
  }[];
  readonly modelError: boolean;
};

/**
 * A call's reply text, null when the call failed, with what the call cost and took, whether it
 * was strict, and whether the provider refused its schema as too large a grammar.
 */
type Answer = {
  readonly attempt: Attempt;
  readonly reply: string | null;
  readonly kept: Call;
  readonly usd: number;
  readonly strict: boolean;
  readonly grammarTooLarge: boolean;
};

/**
 * Sends one chat completion, after checking that its worst case fits the wallet: the system
 * prompt, then a user turn of the photo, a cache breakpoint, and [request], or the text alone.
 * A strict call sends [format] as its structured output; any other states it after [request].
 */
async function send(
  model: Model,
  system: string,
  request: string,
  image: Image | null,
  format: Format,
  strict: boolean,
  deps: TwoStageDeps,
): Promise<Answer> {
  const asked = strict ? request : `${request}\n${looseInstruction(format)}`;
  const worst = worstCallUsd(model.pricing) +
    model.pricing.prompt * [...system, ...asked].length;
  if (!deps.wallet.fits(worst)) throw new OutOfBudget();
  const content = image === null ? [{ type: "text", text: asked }] : [
    {
      type: "image_url",
      image_url: { url: `data:${image.type};base64,${image.base64}` },
    },
    // The breakpoint caches the system prompt and the photo. A provider that renders the reply
    // schema ahead of the messages keys the entry by schema too.
    {
      type: "text",
      text: "This is the page.",
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: asked },
  ];
  const started = deps.now();
  let response: Response;
  try {
    response = await deps.fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        ...(strict
          ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: format.name,
                strict: true,
                schema: format.schema,
              },
            },
          }
          : {}),
        provider: { require_parameters: true },
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
  } catch (error) {
    return {
      attempt: {
        model: model.id,
        latencyMs: deps.now() - started,
        usage: null,
        timedOut: false,
      },
      reply: null,
      kept: { error: String(error) },
      usd: 0,
      strict,
      grammarTooLarge: false,
    };
  }
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // A body that is not JSON is kept as its text.
  }
  const usage = readUsage(body);
  const usd = callUsd(model.pricing, usage);
  deps.wallet.spend(usd);
  return {
    attempt: {
      model: model.id,
      latencyMs: deps.now() - started,
      usage,
      timedOut: false,
    },
    reply: response.ok ? readReply(body) ?? "" : null,
    kept: { status: response.status, body },
    usd,
    strict,
    grammarTooLarge: strict && response.status === 400 &&
      GRAMMAR_TOO_LARGE.test(raw),
  };
}

/** What a call not held to [format] is told after its request. */
function looseInstruction(format: Format): string {
  return `Answer with one JSON value and nothing else, matching this JSON schema: ${
    JSON.stringify(format.schema)
  }`;
}

/** One step's calls and its reply, read by its parser, or null when none was valid. */
type Asked<T> = {
  readonly value: T | null;
  readonly answers: readonly Answer[];
};

/**
 * Asks [request] in [format], and reads the reply with [parse]. A format the provider refuses as
 * too large a grammar is asked again as plain JSON, as is every later call in it on [model] in
 * the run; a plain JSON reply [parse] refuses is asked once more.
 */
async function ask<T>(
  model: Model,
  request: string,
  image: Image,
  format: Format,
  parse: (value: unknown) => T | null,
  deps: TwoStageDeps,
): Promise<Asked<T>> {
  const answers: Answer[] = [];
  const key = looseKey(model, format);
  if (!deps.loose.has(key)) {
    const answer = await send(
      model,
      TWO_STAGE_PROMPT,
      request,
      image,
      format,
      true,
      deps,
    );
    answers.push(answer);
    if (!answer.grammarTooLarge) {
      return { value: parse(jsonOf(answer.reply)), answers };
    }
    deps.loose.add(key);
  }
  for (let tries = 0; tries < 2; tries += 1) {
    const answer = await send(
      model,
      TWO_STAGE_PROMPT,
      request,
      image,
      format,
      false,
      deps,
    );
    answers.push(answer);
    const value = parse(jsonOf(answer.reply));
    if (value !== null || answer.reply === null) return { value, answers };
  }
  return { value: null, answers };
}

/** What [answers] cost and took in all, and whether the last of them failed. */
function totalOf(answers: readonly Answer[]) {
  return {
    usd: answers.reduce((total, answer) => total + answer.usd, 0),
    latencyMs: answers.reduce(
      (total, answer) => total + answer.attempt.latencyMs,
      0,
    ),
    failed: answers.at(-1)?.reply === null,
  };
}

function readReply(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === "string"
    ? choice.message.content
    : null;
}

function readUsage(body: unknown): Usage | null {
  if (!isRecord(body) || !isRecord(body.usage)) return null;
  const { prompt_tokens, completion_tokens, cost, cost_details } = body.usage;
  if (
    typeof prompt_tokens !== "number" || typeof completion_tokens !== "number"
  ) return null;
  // A call billed through the owner's own provider key (BYOK) reports the provider's price here,
  // and only OpenRouter's own fee in `cost`; the rule #419 gives `providers.ts`.
  const upstream = isRecord(cost_details)
    ? cost_details.upstream_inference_cost
    : undefined;
  const parts = [cost, upstream].filter((part) => typeof part === "number");
  return {
    promptTokens: prompt_tokens,
    completionTokens: completion_tokens,
    costUsd: parts.length === 0
      ? null
      : parts.reduce((total, part) => total + part, 0),
  };
}

/** The JSON of a reply's text, inside a code fence or not, or undefined when it is not JSON. */
function jsonOf(text: string | null): unknown {
  if (text === null) return undefined;
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  try {
    return JSON.parse(fenced?.[1] ?? text);
  } catch {
    return undefined;
  }
}

/** The language hints of a sample, as a sentence after the request, or nothing. */
function hints(languages: LanguageHints): string {
  return [
    languages.front === undefined
      ? null
      : `The cards' fronts are in the language ${languages.front}.`,
    languages.back === undefined
      ? null
      : `Their answers are in the language ${languages.back}.`,
  ].filter((hint) => hint !== null).map((hint) => ` ${hint}`).join("");
}

/** The request of stage 1. */
export function sectionsRequest(languages: LanguageHints): string {
  return `Return the page's sections.${hints(languages)}`;
}

/** The request of stage 2 for [shape] of [section]. */
export function shapeRequest(
  shape: Shape,
  section: Section,
  languages: LanguageHints,
): string {
  return `Return the shape ${shape} for this section.${hints(languages)}\n${
    JSON.stringify(flatOf(section))
  }`;
}

/** The judge's request: the page's lines, then each composed sentence numbered from 1. */
export function judgeRequest(
  lines: readonly string[],
  sentences: readonly string[],
): string {
  return [
    "The page's lines:",
    ...lines,
    "",
    "The sentences:",
    ...sentences.map((sentence, i) => `${i + 1}. ${sentence}`),
  ].join("\n");
}

/**
 * The judge's verdicts, one per sentence in order, or null when the reply does not give exactly
 * one for each of [count] sentences, numbered from 1.
 */
export function parseVerdicts(
  text: string | null,
  count: number,
): boolean[] | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ["verdicts"])) return null;
  const verdicts = list(
    value.verdicts,
    count,
    (verdict) =>
      isRecord(verdict) && hasOnlyKeys(verdict, ["id", "supported"]) &&
        Number.isInteger(verdict.id) && typeof verdict.supported === "boolean"
        ? { id: verdict.id as number, supported: verdict.supported }
        : null,
  );
  if (verdicts === null || verdicts.length !== count) return null;
  return verdicts.every((verdict, i) => verdict.id === i + 1)
    ? verdicts.map((verdict) => verdict.supported)
    : null;
}

/** The ground truth a page is scored on: a sample, and its sections when it records them. */
export type PageTruth = {
  readonly sample: Sample;
  readonly sections: readonly Section<TruthLine>[] | null;
};

/** Today's single call on one page, scored as the eval scores it. */
export async function runSingle(
  configuration: Extract<Configuration, { kind: "single" }>,
  truth: PageTruth,
  deps: TwoStageDeps,
): Promise<PageRun> {
  const { sample } = truth;
  if (!deps.wallet.fits(worstCallUsd(configuration.model.pricing))) {
    throw new OutOfBudget();
  }
  const calls: Call[] = [];
  const extraction = await extractCards(
    sample.image,
    sample.languages,
    configuration.model.id,
    deps.singlePrompt,
    {
      ...deps,
      provider: "openrouter",
      fetch: recording(deps.fetch, calls),
      timeoutMs: MODEL_TIMEOUT_MS,
    },
  );
  const [attempt] = extraction.attempts;
  const usd = callUsd(configuration.model.pricing, attempt.usage);
  deps.wallet.spend(usd);
  const cards: readonly Card[] = extraction.kind === "cards"
    ? extraction.cards
    : [];
  return {
    result: {
      name: sample.name,
      vocabulary: sample.kind === "vocabulary"
        ? score(cards.map(entryOf), sample.cards)
        : null,
      notes: sample.kind === "notes" ? scoreNotes(cards, sample.notes) : null,
      structure: null,
      marks: null,
      spans: null,
      shapes: [],
      composed: { judged: 0, unsupported: 0 },
      stage1Ms: null,
      totalMs: attempt.latencyMs,
      photoUsd: usd,
      spentUsd: usd,
    },
    calls: [{
      step: "single",
      model: attempt.model,
      strict: true,
      ...(calls[0] ?? { error: "no answer was recorded" }),
    }],
    cards,
    composed: [],
    modelError: extraction.kind === "model_error",
  };
}

/** One stage-2 step's outcome: the shape asked for, its checked reply or null, and its calls. */
type ShapeRun = {
  readonly section: Section;
  readonly shape: Shape;
  readonly isDefault: boolean;
  readonly output: ShapeOutput | null;
  readonly answers: readonly Answer[];
};

/** [answers] as kept, each with what it asked for. */
function keptOf(
  answers: readonly Answer[],
  asked: Pick<KeptCall, "step" | "section" | "shape">,
): KeptCall[] {
  return answers.map((answer) => ({
    ...asked,
    model: answer.attempt.model,
    strict: answer.strict,
    ...answer.kept,
  }));
}

/**
 * Stage 1 and stage 2 on one page, then the judge over the sentences stage 2 composed. Stage 2
 * makes every shape of every section, each section's default shape first, so the default shapes
 * are the ones that pay the cache's write as the app's one shape a section would.
 */
export async function runTwoStage(
  configuration: Extract<Configuration, { kind: "two_stage" }>,
  truth: PageTruth,
  deps: TwoStageDeps,
): Promise<PageRun> {
  const { sample } = truth;
  const stage1 = await ask(
    configuration.sections,
    sectionsRequest(sample.languages),
    sample.image,
    SECTIONS_FORMAT,
    parseSections,
    deps,
  );
  const kept = keptOf(stage1.answers, { step: "sections" });
  const first = totalOf(stage1.answers);
  const sections = stage1.value;
  const asked = (sections ?? []).flatMap((section) =>
    shapesFor(section.content_type).map((shape, i) => ({
      section,
      shape,
      isDefault: i === 0,
    }))
  ).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const runs: ShapeRun[] = [];
  for (const { section, shape, isDefault } of asked) {
    const { value, answers } = await ask(
      configuration.shapes,
      shapeRequest(shape, section, sample.languages),
      sample.image,
      shapeFormat(shape),
      (reply) => parseShape(shape, reply, section),
      deps,
    );
    kept.push(
      ...keptOf(answers, { step: "shape", section: section.title, shape }),
    );
    runs.push({ section, shape, isDefault, output: value, answers });
  }
  const valid = runs.flatMap((run) =>
    run.output === null ? [] : [{ ...run, output: run.output }]
  );
  const defaults = valid.filter((run) => run.isDefault);
  const cards = defaults.flatMap((run) => cardsOf(run.output, run.section));
  const composed = valid.flatMap((run) => composedOf(run.output));
  let judged = { judged: 0, unsupported: 0 };
  let verdicts: boolean[] | null = null;
  let judgeUsd = 0;
  if (sample.kind === "notes" && composed.length > 0) {
    const verdict = await send(
      deps.judge,
      JUDGE_PROMPT,
      judgeRequest(sample.notes.lines, composed),
      null,
      { name: "verdicts", schema: judgeSchema },
      true,
      deps,
    );
    kept.push(...keptOf([verdict], { step: "judge" }));
    judgeUsd = verdict.usd;
    verdicts = parseVerdicts(verdict.reply, composed.length);
    if (verdicts !== null) {
      judged = {
        judged: verdicts.length,
        unsupported: verdicts.filter((supported) => !supported).length,
      };
    }
  }
  const blanks = (shapes: readonly Shape[]): LineBlank[] =>
    valid.filter((run) => shapes.includes(run.shape)).flatMap((run) =>
      lineBlanksOf(run.output, run.section)
    );
  const defaultMs = runs.filter((run) => run.isDefault).map((run) =>
    totalOf(run.answers).latencyMs
  );
  const pageTruth = truth.sections;
  const stageUsd = (pick: readonly ShapeRun[]) =>
    pick.reduce((total, run) => total + totalOf(run.answers).usd, 0);
  return {
    result: {
      name: sample.name,
      vocabulary: sample.kind === "vocabulary"
        ? score(
          defaults.flatMap((run) =>
            run.output.kind === "vocabulary"
              ? run.output.cards.map(entryOf)
              : []
          ),
          sample.cards,
        )
        : null,
      notes: sample.kind === "notes" ? scoreNotes(cards, sample.notes) : null,
      structure: pageTruth === null
        ? null
        : scoreStructure(sections ?? [], pageTruth),
      marks: pageTruth === null
        ? null
        : scoreMarks(blanks(["cloze", "table_spans"]), pageTruth),
      spans: pageTruth === null
        ? null
        : scoreSpans(blanks(["table_spans"]), pageTruth),
      shapes: runs.map((run) => ({
        shape: run.shape,
        valid: run.output !== null,
      })),
      composed: judged,
      stage1Ms: first.latencyMs,
      totalMs: first.latencyMs + Math.max(0, ...defaultMs),
      photoUsd: first.usd + stageUsd(runs.filter((run) => run.isDefault)),
      spentUsd: first.usd + stageUsd(runs) + judgeUsd,
    },
    calls: kept,
    cards: [
      ...(sections === null ? [] : [{ sections }]),
      ...valid.map((run) => ({ section: run.section.title, ...run.output })),
    ],
    composed: composed.map((sentence, i) => ({
      sentence,
      supported: verdicts?.[i] ?? null,
    })),
    modelError: first.failed,
  };
}

/** One preflight call as printed: what it asked, how, and what came back. */
export type PreflightCall = {
  /** `sections`, or the shape asked. */
  readonly asked: string;
  readonly model: string;
  readonly strict: boolean;
  /** The HTTP status, or null when the request got no answer. */
  readonly status: number | null;
  /** Whether this call's reply was valid; a call followed by another of its step never is. */
  readonly valid: boolean;
  readonly promptTokens: number | null;
  /** The prompt tokens OpenRouter reported read from the cache, or null when it reported none. */
  readonly cachedTokens: number | null;
  readonly usd: number;
};

/**
 * The section the preflight asks every shape of: [truth]'s first table, each line's blanks given
 * as its key terms, or null when the truth records no table.
 */
export function preflightSection(truth: PageTruth): Section | null {
  const table = truth.sections?.find((section) =>
    TABLE_CONTENT.includes(section.content_type)
  )?.table;
  if (table === undefined || table === null) return null;
  const line = (truthLine: TruthLine): Line => ({
    id: truthLine.id,
    text: truthLine.text,
    role: "fact",
    marks: truthLine.marks,
    key_terms: truthLine.blanks.map((blank) => ({ ...blank, source: "model" })),
  });
  const section = truth.sections?.find((one) => one.table === table);
  return section === undefined ? null : {
    ...section,
    lines: [],
    table: {
      columns: table.columns,
      rows: table.rows.map((row) => ({
        header: row.header,
        cells: row.cells.map((cell) => ({ lines: cell.lines.map(line) })),
      })),
    },
  };
}

/**
 * The preflight on one page: a real stage-1 call, then one call of every shape on [section], so
 * that each schema meets the provider once, before a run. It scores nothing.
 */
export async function preflight(
  configuration: Extract<Configuration, { kind: "two_stage" }>,
  truth: PageTruth,
  section: Section,
  deps: TwoStageDeps,
): Promise<{ readonly calls: KeptCall[]; readonly rows: PreflightCall[] }> {
  const { sample } = truth;
  const calls: KeptCall[] = [];
  const rows: PreflightCall[] = [];
  const record = <T>(
    asked: Asked<T>,
    step: Pick<KeptCall, "step" | "shape">,
  ) => {
    calls.push(...keptOf(asked.answers, step));
    rows.push(...asked.answers.map((answer, i) => ({
      asked: step.shape ?? "sections",
      model: answer.attempt.model,
      strict: answer.strict,
      status: "status" in answer.kept ? answer.kept.status : null,
      valid: i === asked.answers.length - 1 && asked.value !== null,
      promptTokens: answer.attempt.usage?.promptTokens ?? null,
      cachedTokens: cachedTokensOf(answer.kept),
      usd: answer.usd,
    })));
  };
  record(
    await ask(
      configuration.sections,
      sectionsRequest(sample.languages),
      sample.image,
      SECTIONS_FORMAT,
      parseSections,
      deps,
    ),
    { step: "sections" },
  );
  for (const shape of SHAPES) {
    record(
      await ask(
        configuration.shapes,
        shapeRequest(shape, section, sample.languages),
        sample.image,
        shapeFormat(shape),
        (reply) => parseShape(shape, reply, section),
        deps,
      ),
      { step: "shape", shape },
    );
  }
  return { calls, rows };
}

/** `usage.prompt_tokens_details.cached_tokens` of a kept reply, or null when it has none. */
function cachedTokensOf(kept: Call): number | null {
  if (!("body" in kept) || !isRecord(kept.body)) return null;
  const usage = kept.body.usage;
  const details = isRecord(usage) ? usage.prompt_tokens_details : undefined;
  return isRecord(details) && typeof details.cached_tokens === "number"
    ? details.cached_tokens
    : null;
}

/** Typical tokens the dry estimate prices a two-stage page at, beside `budget.ts`'s. */
export const TYPICAL_LINE_TOKENS = 40;
export const TYPICAL_SHAPE_TOKENS_PER_LINE = 60;
export const TYPICAL_VERDICT_TOKENS = 20;
/** The sections a page whose truth records none is taken to hold, each a list. */
export const TYPICAL_SECTIONS = 3;

/** A section as the dry estimate sees it: its content type and how many lines it holds. */
export type PlannedSection = {
  readonly content_type: Section["content_type"];
  readonly lines: number;
  /** The cells holding lines, which a table's questions ask one each. */
  readonly cells: number;
};

/**
 * The sections a page is planned with: its truth's, a vocabulary page's one list, or a notes
 * page's lines split over `TYPICAL_SECTIONS` lists.
 */
export function plannedSections(truth: PageTruth): PlannedSection[] {
  if (truth.sections !== null) {
    return truth.sections.map((section) => ({
      content_type: section.content_type,
      lines: linesOf(section).length,
      cells: section.table?.rows.flatMap((row) =>
        row.cells.filter((cell) =>
          cell.lines.length > 0
        )
      ).length ?? 0,
    }));
  }
  if (truth.sample.kind === "vocabulary") {
    return [{
      content_type: "vocabulary_list",
      lines: truth.sample.cards.length,
      cells: 0,
    }];
  }
  const lines = Math.ceil(truth.sample.notes.lines.length / TYPICAL_SECTIONS);
  return Array.from({ length: TYPICAL_SECTIONS }, () => ({
    content_type: "rule_list" as const,
    lines,
    cells: 0,
  }));
}

/** The lines a page's notes print, or a vocabulary page's two a card, for the estimate. */
export function plannedLines(truth: PageTruth): number {
  return truth.sample.kind === "notes"
    ? truth.sample.notes.lines.length
    : truth.sample.cards.length * 2;
}
