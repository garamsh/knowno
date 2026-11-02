/**
 * The extract-cards model eval. From the repository root:
 *
 *   deno run --allow-read --allow-write=tools/eval/spend.json,docs/eval,tools/eval/replies \
 *     --allow-net=openrouter.ai --allow-env=OPENROUTER_API_KEY --env-file=supabase/functions/.env \
 *     tools/eval/run.ts [--dry-run] [--prompts <file>,<file>... | --prompt-version <id>]
 *     [--alternatives today,lean,cap] [--samples <NN>,<NN>...]
 *
 * It runs prompt v10, the newest prompt file, unless `--prompts` names prompt files, such as
 * `--prompts v9,v10`, each run on every configuration as a row of its own, or
 * `--prompt-version` names a version saved in the admin area (ADR 0073), which it reads through
 * `public.prompt_version` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; that run also needs
 * both names in `--allow-env` and the project's host in `--allow-net`. `--alternatives` runs each
 * named way of reading a photo (`dense.ts`, ADR 0135) as rows of its own, and `--samples` runs only
 * the samples of those numbers.
 *
 * It resolves `candidates.json` against OpenRouter's model list, estimates the run's cost,
 * and refuses to start one the remaining budget in `spend.json` cannot cover. `--dry-run`
 * stops after the estimate and calls no model. Every reply is kept in a folder of
 * `tools/eval/replies/` named for the run's start, which git ignores. Each call is instructed as
 * the function instructs it: the prompt, then the output contract (ADR 0124).
 */

import {
  type CardRule,
  type Extra,
  parseExtra,
  parseSense,
  type Sense,
} from "../../supabase/functions/extract-cards/cards.ts";
import { type Alternative, ALTERNATIVES } from "./dense.ts";
import {
  type Extraction,
  MAX_OUTPUT_TOKENS,
  MODEL_TIMEOUT_MS,
} from "../../supabase/functions/extract-cards/model.ts";
import { OPENROUTER_URL } from "../../supabase/functions/extract-cards/providers.ts";
import * as v9 from "../../supabase/functions/extract-cards/prompt_v9.ts";
import * as v10 from "../../supabase/functions/extract-cards/prompt_v10.ts";
import type {
  Image,
  LanguageHints,
  LanguageTag,
} from "../../supabase/functions/extract-cards/request.ts";
import {
  callUsd,
  estimateUsd,
  type Ledger,
  parseLedger,
  remaining,
  type SampleSize,
  spent,
  TYPICAL_NOTE_TOKENS_PER_CARD,
  TYPICAL_VOCABULARY_TOKENS_PER_CARD,
  worstCallUsd,
} from "./budget.ts";
import {
  type Blank,
  type Entry,
  entryOf,
  EXCEPTION_WORDS,
  type Fact,
  type ImageResult,
  MAX_LISTED_ITEMS,
  type NotesTruth,
  recommend,
  type Row,
  score,
  scoreNotes,
  STEPS,
  summarize,
  type VocabularyRates,
} from "./metrics.ts";
import {
  type Candidate,
  type Model,
  MODELS_URL,
  parseModels,
  parseSelectors,
  resolve,
} from "./models.ts";

export const PATHS = {
  candidates: "tools/eval/candidates.json",
  ledger: "tools/eval/spend.json",
  samples: "tools/eval/samples",
  report: "docs/eval/extract-cards.md",
  replies: "tools/eval/replies",
} as const;

/** A candidate's images stop running after this many model errors in a row. */
export const MODEL_ERRORS_TO_STOP = 2;

/**
 * One labelled photo: its name, the image as the function receives it, its hints, and its
 * ground truth: a vocabulary page's cards, or a notes page's rules and exceptions and its lines.
 */
export type Sample =
  & {
    readonly name: string;
    readonly image: Image;
    readonly languages: LanguageHints;
  }
  & (
    | { readonly kind: "vocabulary"; readonly cards: readonly Entry[] }
    | { readonly kind: "notes"; readonly notes: NotesTruth }
  );

/** How large a sample's reply is taken to be in the dry estimate. */
export function sizeOf(sample: Sample): SampleSize {
  return sample.kind === "vocabulary"
    ? {
      cards: sample.cards.length,
      tokensPerCard: TYPICAL_VOCABULARY_TOKENS_PER_CARD,
    }
    : {
      cards: sample.notes.facts.length,
      tokensPerCard: TYPICAL_NOTE_TOKENS_PER_CARD,
    };
}

/** Everything the eval reads, writes, or calls, so a test can stand in for each. */
export type Io = {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly env: (name: string) => string | undefined;
  readonly readText: (path: string) => Promise<string>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly list: (dir: string) => Promise<string[]>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly print: (line: string) => void;
  /** Today's date as YYYY-MM-DD. */
  readonly today: () => string;
  /** The current UTC time as an ISO 8601 string. */
  readonly startedAt: () => string;
};

/** The instructions a run gives the model, and how the ledger and the report name them. */
export type EvalPrompt = { readonly label: string; readonly text: string };

/** The prompt files `--prompts` may name, by their version. */
export const PROMPT_FILES: readonly EvalPrompt[] = [v9, v10].map((file) => ({
  label: file.PROMPT_VERSION,
  text: file.SYSTEM_PROMPT,
}));

/**
 * The prompts a run gives the model: the files `--prompts` names, the version `--prompt-version
 * <id>` names, read from the database, or prompt v10 without either; a sentence saying why when a
 * flag or the read fails.
 */
export async function readPrompts(
  args: readonly string[],
  io: Pick<Io, "env" | "fetch">,
): Promise<readonly EvalPrompt[] | { readonly error: string }> {
  const files = args.indexOf("--prompts");
  const at = args.indexOf("--prompt-version");
  if (files !== -1 && at !== -1) {
    return { error: "--prompts and --prompt-version cannot be given together" };
  }
  if (files !== -1) {
    const names = (args[files + 1] ?? "").split(",");
    const prompts = names.map((name) =>
      PROMPT_FILES.find((file) => file.label === name)
    );
    if (
      prompts.some((prompt) => prompt === undefined) ||
      new Set(names).size !== names.length
    ) {
      return {
        error: `--prompts takes distinct prompt files among ${
          PROMPT_FILES.map((file) => file.label).join(", ")
        }, separated by commas`,
      };
    }
    return prompts.filter((prompt) => prompt !== undefined);
  }
  if (at === -1) {
    return [{ label: v10.PROMPT_VERSION, text: v10.SYSTEM_PROMPT }];
  }
  const id = args[at + 1];
  if (id === undefined || !/^[1-9]\d{0,15}$/.test(id)) {
    return {
      error: "--prompt-version takes a version's id, a positive whole number",
    };
  }
  const url = io.env("SUPABASE_URL")?.trim();
  const key = io.env("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) {
    return {
      error:
        "--prompt-version needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    };
  }
  const response = await io.fetch(`${url}/rest/v1/rpc/prompt_version`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version_id: Number(id) }),
  });
  if (!response.ok) {
    return { error: `prompt_version answered ${response.status}` };
  }
  const rows: unknown = await response.json();
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
  if (row === undefined) return { error: `no prompt version ${id}` };
  const text = typeof row === "object" && row !== null && "text" in row
    ? row.text
    : undefined;
  if (typeof text !== "string" || text.trim() === "") {
    return { error: "prompt_version answered a row it should not" };
  }
  return [{ label: `version ${id}`, text }];
}

/**
 * The ways of reading each photo a run measures (ADR 0135): those `--alternatives` names, such as
 * `--alternatives today,lean,cap`, or the function's own way without it; a sentence
 * saying why when the flag names none it knows.
 */
export function readAlternatives(
  args: readonly string[],
): readonly Alternative[] | { readonly error: string } {
  const at = args.indexOf("--alternatives");
  if (at === -1) return [ALTERNATIVES[0]];
  const names = (args[at + 1] ?? "").split(",");
  const named = names.map((name) =>
    ALTERNATIVES.find((alternative) => alternative.label === name)
  );
  if (
    named.some((alternative) => alternative === undefined) ||
    new Set(names).size !== names.length
  ) {
    return {
      error: `--alternatives takes distinct ways among ${
        ALTERNATIVES.map((alternative) => alternative.label).join(", ")
      }, separated by commas`,
    };
  }
  return named.filter((alternative) => alternative !== undefined);
}

/**
 * The samples `--samples` names by their number, such as `--samples 90`, or every sample without
 * it; a sentence saying why when a number names no sample.
 */
export function pickSamples(
  args: readonly string[],
  samples: readonly Sample[],
): readonly Sample[] | { readonly error: string } {
  const at = args.indexOf("--samples");
  if (at === -1) return samples;
  const numbers = (args[at + 1] ?? "").split(",");
  const picked = samples.filter((sample) =>
    numbers.includes(sample.name.split("-")[0])
  );
  return picked.length === numbers.length ? picked : {
    error:
      "--samples takes the numbers of samples in tools/eval/samples/, separated by commas",
  };
}

/** Runs the eval and returns the process exit code. */
export async function main(args: readonly string[], io: Io): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const prompts = await readPrompts(args, io);
  if ("error" in prompts) {
    io.print(prompts.error);
    return 1;
  }
  const alternatives = readAlternatives(args);
  if ("error" in alternatives) {
    io.print(alternatives.error);
    return 1;
  }
  const promptLabel = prompts.map((prompt) => prompt.label).join(" and ");
  const selectors = parseSelectors(
    JSON.parse(await io.readText(PATHS.candidates)),
  );
  const ledger = parseLedger(JSON.parse(await io.readText(PATHS.ledger)));
  const picked = pickSamples(args, await loadSamples(io));
  if ("error" in picked) {
    io.print(picked.error);
    return 1;
  }
  const samples = picked;
  if (samples.length === 0) {
    io.print(`no sample in ${PATHS.samples}/`);
    return 1;
  }

  const response = await io.fetch(MODELS_URL);
  if (!response.ok) {
    io.print(`the model list answered ${response.status}`);
    return 1;
  }
  const resolved = resolve(selectors, parseModels(await response.json()));
  if (!resolved.ok) {
    io.print(
      `no model with image input and structured outputs matches: ${
        resolved.unresolved.join(", ")
      }`,
    );
    io.print(`edit ${PATHS.candidates} to name current models`);
    return 1;
  }
  const candidates = resolved.candidates;
  for (const candidate of candidates) {
    io.print(`${candidate.label}: ${describe(candidate)}`);
  }

  // A way that may make several calls an image is priced at the most it may make.
  const estimate = estimateUsd(candidates, samples.map(sizeOf)) *
    prompts.length *
    alternatives.reduce((calls, alternative) => calls + alternative.calls, 0);
  const alternativeLabel = alternatives.map((alternative) => alternative.label)
    .join(", ");
  const notes = samples.filter((sample) => sample.kind === "notes").length;
  const left = remaining(ledger);
  io.print(
    `${samples.length} samples (${
      samples.length - notes
    } vocabulary, ${notes} notes) x ${candidates.length} configurations x prompt ${promptLabel}${
      alternatives.length === 1 ? "" : ` x ${alternativeLabel}`
    }: estimated ${usd(estimate)}, ` +
      `${usd(left)} of the ${usd(ledger.budgetUsd)} budget remaining`,
  );
  if (dryRun) return 0;
  if (estimate > left) {
    io.print(`refused: the estimate exceeds the remaining budget`);
    return 1;
  }
  const apiKey = io.env("OPENROUTER_API_KEY")?.trim();
  if (apiKey === undefined || apiKey === "") {
    io.print(
      "OPENROUTER_API_KEY is not set; pass --env-file=supabase/functions/.env",
    );
    return 1;
  }

  const replies = `${PATHS.replies}/${
    io.startedAt().replace(/\.\d+/, "").replaceAll(":", "-")
  }`;
  io.print(`keeping every reply in ${replies}/`);
  const run = await runPrompts(
    prompts,
    alternatives,
    candidates,
    samples,
    ledger,
    {
      apiKey,
      fetch: io.fetch,
      now: io.now,
      timeoutMs: MODEL_TIMEOUT_MS,
      print: io.print,
      keep: (path, reply) =>
        io.writeText(
          `${replies}/${path}`,
          JSON.stringify(reply, null, 2) + "\n",
        ),
    },
  );
  const updated: Ledger = {
    ...ledger,
    runs: [...ledger.runs, {
      date: io.today(),
      spentUsd: round(run.spentUsd),
      note: run.stopped
        ? "stopped before exceeding the budget"
        : alternatives.length === 1
        ? `prompt ${promptLabel}`
        : `prompt ${promptLabel}, ${alternativeLabel}`,
    }],
  };
  io.print(
    `this run spent ${usd(run.spentUsd)}; ${usd(spent(updated))} of ${
      usd(updated.budgetUsd)
    } spent in total`,
  );
  // The report is written before the ledger, and the ledger even when the report fails, so a
  // failed write after the paid calls loses at most one of them.
  try {
    if (!run.stopped) {
      await io.writeText(
        PATHS.report,
        report(
          candidates,
          run.rows,
          samples.length,
          run.spentUsd,
          updated,
          io.today(),
          { replies, halted: run.halted },
          promptLabel,
          run.outcomes,
        ),
      );
      io.print(`wrote ${PATHS.report}`);
    }
  } finally {
    await io.writeText(PATHS.ledger, JSON.stringify(updated, null, 2) + "\n");
  }
  if (run.stopped) {
    io.print(
      "stopped: the next call could have exceeded the remaining budget; no report was written",
    );
    return 1;
  }
  return 0;
}

/** What a run returns: its rows, its spend, whether it stopped, its halts and its outcomes. */
export type RunResult = {
  rows: Row[];
  spentUsd: number;
  stopped: boolean;
  halted: Halt[];
  outcomes: Outcomes[];
};

/**
 * `runEval` once per prompt and way of reading, each configuration labelled with its prompt and its
 * way when there are several, so the rows of one model compare them; each run's budget is what the
 * earlier left.
 */
export async function runPrompts(
  prompts: readonly EvalPrompt[],
  alternatives: readonly Alternative[],
  candidates: readonly Candidate[],
  samples: readonly Sample[],
  ledger: Ledger,
  deps: Omit<RunDeps, "prompt" | "alternative">,
): Promise<RunResult> {
  const total: RunResult = {
    rows: [],
    spentUsd: 0,
    stopped: false,
    halted: [],
    outcomes: [],
  };
  for (const prompt of prompts) {
    for (const alternative of alternatives) {
      const suffix = [
        ...(prompts.length === 1 ? [] : [`prompt ${prompt.label}`]),
        ...(alternatives.length === 1 ? [] : [alternative.label]),
      ];
      const labelled = suffix.length === 0
        ? candidates
        : candidates.map((candidate) => ({
          ...candidate,
          label: [candidate.label, ...suffix].join(", "),
        }));
      const run = await runEval(labelled, samples, {
        ...ledger,
        budgetUsd: ledger.budgetUsd - total.spentUsd,
      }, { ...deps, prompt, alternative });
      total.rows.push(...run.rows);
      total.spentUsd += run.spentUsd;
      total.halted.push(...run.halted);
      total.outcomes.push(...run.outcomes);
      if (run.stopped) return { ...total, stopped: true };
    }
  }
  return total;
}

/**
 * How one configuration's replies ended: the images whose reply saved no card as invalid output,
 * those whose call failed, the cards the replies returned that broke a rule of the output
 * contract and were dropped, counted by rule, the cards kept, and the images whose answered reply
 * was cut at the output cap (ADR 0135).
 */
export type Outcomes = {
  readonly label: string;
  readonly images: number;
  readonly invalidOutputs: number;
  readonly modelErrors: number;
  readonly dropped: ReadonlyMap<CardRule, number>;
  readonly cards: number;
  readonly cutReplies: number;
};

/** One OpenRouter call as it answered: its HTTP status and body, or the error that ended it. */
export type Call =
  | { readonly status: number; readonly body: unknown }
  | { readonly error: string };

/** What one candidate returned for one image: the parsed cards, and every call's answer. */
export type Reply = {
  readonly candidate: string;
  readonly sample: string;
  readonly outcome: Extraction["kind"];
  readonly cards: readonly unknown[];
  /** The rule each dropped card broke, in reply order. */
  readonly dropped: readonly CardRule[];
  readonly calls: readonly ({ readonly model: string } & Call)[];
};

/** A candidate that stopped after model errors in a row, and how many images it ran. */
export type Halt = { readonly label: string; readonly ran: number };

type RunDeps = {
  apiKey: string;
  /** The instructions every call gives the model. */
  prompt: EvalPrompt;
  /** How each photo is read: the function's own call, or a way ADR 0135 measures beside it. */
  alternative: Alternative;
  fetch: typeof fetch;
  now: () => number;
  /** How long one call may take before it is a model error, the function's `MODEL_TIMEOUT_MS`. */
  timeoutMs: number;
  print: (line: string) => void;
  /** Stores one image's reply at [path], relative to the run's replies folder. */
  keep: (path: string, reply: Reply) => Promise<void>;
};

/**
 * Every candidate over every sample, one call at a time. Before each image it checks that the
 * worst case of its one call still fits the remaining budget, and stops otherwise. A
 * candidate whose calls fail `MODEL_ERRORS_TO_STOP` images in a row runs no further image.
 * Each image's reply is kept as it completes.
 */
export async function runEval(
  candidates: readonly Candidate[],
  samples: readonly Sample[],
  ledger: Ledger,
  deps: RunDeps,
): Promise<RunResult> {
  const rows: Row[] = [];
  const halted: Halt[] = [];
  const outcomes: Outcomes[] = [];
  let spentUsd = 0;
  for (const candidate of candidates) {
    const pricing = new Map<string, Model>([[
      candidate.primary.id,
      candidate.primary,
    ]]);
    const results: ImageResult[] = [];
    const tally = {
      label: candidate.label,
      images: 0,
      invalidOutputs: 0,
      modelErrors: 0,
      dropped: new Map<CardRule, number>(),
      cards: 0,
      cutReplies: 0,
    };
    outcomes.push(tally);
    let errorsInRow = 0;
    for (const sample of samples) {
      if (errorsInRow === MODEL_ERRORS_TO_STOP) {
        halted.push({ label: candidate.label, ran: results.length });
        deps.print(
          `${candidate.label}: stopped after ${MODEL_ERRORS_TO_STOP} model errors in a row, ${results.length} of ${samples.length} images run`,
        );
        break;
      }
      const worst = worstCallUsd(
        candidate.primary.pricing,
        deps.alternative.maxTokens,
      ) * deps.alternative.calls;
      if (spentUsd + worst > remaining(ledger)) {
        return { rows, spentUsd, stopped: true, halted, outcomes };
      }
      const calls: Call[] = [];
      const extraction = await deps.alternative.extract(
        sample.image,
        sample.languages,
        candidate.primary.id,
        deps.prompt.text,
        { ...deps, provider: "openrouter", fetch: recording(deps.fetch, calls) },
      );
      errorsInRow = extraction.kind === "model_error" ? errorsInRow + 1 : 0;
      let costUsd = 0;
      let latencyMs = 0;
      let completionTokens = 0;
      for (const attempt of extraction.attempts) {
        const model = pricing.get(attempt.model);
        if (model === undefined) {
          throw new Error(
            `a call used ${attempt.model}, which ${candidate.label} does not`,
          );
        }
        costUsd += callUsd(model.pricing, attempt.usage);
        latencyMs += attempt.latencyMs;
        completionTokens += attempt.usage?.completionTokens ?? 0;
      }
      spentUsd += costUsd;
      const cards = extraction.kind === "cards" ? extraction.cards : [];
      const dropped = extraction.kind === "cards" ||
          extraction.kind === "invalid_output"
        ? extraction.dropped
        : [];
      tally.images += 1;
      if (extraction.kind === "invalid_output") tally.invalidOutputs += 1;
      if (extraction.kind === "model_error") tally.modelErrors += 1;
      tally.cards += cards.length;
      if (extraction.kind === "cards" && extraction.cut) tally.cutReplies += 1;
      for (const rule of dropped) {
        tally.dropped.set(rule, (tally.dropped.get(rule) ?? 0) + 1);
      }
      await deps.keep(`${slug(candidate.label)}/${sample.name}.json`, {
        candidate: candidate.label,
        sample: sample.name,
        outcome: extraction.kind,
        cards,
        dropped,
        calls: extraction.attempts.map((attempt, i) => ({
          model: attempt.model,
          ...(attempt.timedOut
            ? { error: `timed out after ${deps.timeoutMs} ms` }
            : calls[i] ?? { error: "no answer was recorded" }),
        })),
      });
      results.push({
        name: sample.name,
        score: sample.kind === "vocabulary"
          ? score(cards.map(entryOf), sample.cards)
          : null,
        notes: sample.kind === "notes" ? scoreNotes(cards, sample.notes) : null,
        latencyMs,
        costUsd,
        completionTokens,
      });
      deps.print(
        `${candidate.label} ${sample.name}: ${extraction.kind}${
          extraction.attempts.some((attempt) => attempt.timedOut)
            ? `, timed out after ${deps.timeoutMs} ms`
            : ""
        }, ${cards.length} cards${
          extraction.kind === "cards" && extraction.cut
            ? ", cut at the cap"
            : ""
        }${dropped.length === 0 ? "" : `, ${dropped.length} cards dropped`}, ${
          usd(costUsd)
        }`,
      );
    }
    rows.push(summarize(candidate.label, results));
  }
  return { rows, spentUsd, stopped: false, halted, outcomes };
}

/** [send], recording each OpenRouter call's status and body, or its error, into [calls]. */
export function recording(send: typeof fetch, calls: Call[]): typeof fetch {
  return async (input, init) => {
    if (String(input) !== OPENROUTER_URL) return send(input, init);
    let response: Response;
    try {
      response = await send(input, init);
    } catch (error) {
      calls.push({ error: String(error) });
      throw error;
    }
    const text = await response.clone().text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A body that is not JSON is kept as its text.
    }
    calls.push({ status: response.status, body });
    return response;
  };
}

/** A configuration's label as a folder name: lower case, runs of other characters as one dash. */
export function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Reads every `NN-*.json` ground truth in the samples folder with the image it names: a
 * vocabulary page's `cards`, or, with `kind` "notes", a notes page's `facts` and `lines`.
 */
export async function loadSamples(
  io: Pick<Io, "list" | "readText" | "readBytes">,
): Promise<Sample[]> {
  const names = (await io.list(PATHS.samples)).filter((name) =>
    name.endsWith(".json")
  ).sort();
  const samples: Sample[] = [];
  for (const name of names) {
    const truth: unknown = JSON.parse(
      await io.readText(`${PATHS.samples}/${name}`),
    );
    if (!isRecord(truth) || typeof truth.image !== "string") {
      throw new Error(`${name} is not a ground truth naming its image`);
    }
    const bytes = await io.readBytes(`${PATHS.samples}/${truth.image}`);
    const type = truth.image.endsWith(".png")
      ? "image/png"
      : truth.image.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
    const photo = {
      name: name.replace(/\.json$/, ""),
      image: { type, base64: encodeBase64(bytes) },
      languages: languages(truth.languages),
    } as const;
    if (truth.kind === "notes") {
      const notes = parseNotes(truth);
      if (notes === null) {
        throw new Error(
          `${name} is not a notes ground truth of {facts: [{id, step, terms, examples?}], lines, tableBlanks?: [{id, terms}], clozeBlanks?: [{id, terms}]}`,
        );
      }
      samples.push({ ...photo, kind: "notes", notes });
      continue;
    }
    if (!Array.isArray(truth.cards)) {
      throw new Error(`${name} is not a ground truth of {image, cards}`);
    }
    const cards = truth.cards.map((card: unknown) => {
      const entry = parseEntry(card);
      if (entry === null) {
        throw new Error(
          `${name} holds a card that is not {front, senses: [{labels, meaning, examples}], examples?, extras?}`,
        );
      }
      return entry;
    });
    samples.push({ ...photo, kind: "vocabulary", cards });
  }
  return samples;
}

function parseNotes(truth: Record<string, unknown>): NotesTruth | null {
  const { facts, lines } = truth;
  const tableBlanks = parseBlanks(truth.tableBlanks);
  const clozeBlanks = parseBlanks(truth.clozeBlanks);
  if (tableBlanks === null || clozeBlanks === null) return null;
  if (
    !Array.isArray(facts) || facts.length === 0 ||
    !Array.isArray(lines) || lines.length === 0 ||
    !lines.every((line) => typeof line === "string")
  ) return null;
  const parsed: Fact[] = [];
  for (const fact of facts) {
    if (!isRecord(fact) || typeof fact.id !== "string") return null;
    const step = STEPS.find((known) => known === fact.step);
    const { terms, examples = [] } = fact;
    if (
      step === undefined || !Array.isArray(terms) || terms.length === 0 ||
      !terms.every((term) => typeof term === "string" && term.trim() !== "") ||
      !Array.isArray(examples) ||
      !examples.every((example) => typeof example === "string")
    ) return null;
    parsed.push({ id: fact.id, step, terms, examples });
  }
  return {
    facts: parsed,
    lines,
    ...(tableBlanks === undefined ? {} : { tableBlanks }),
    ...(clozeBlanks === undefined ? {} : { clozeBlanks }),
  };
}

/** A truth's blanks, undefined when it names none, or null when they are not [{id, terms}]. */
function parseBlanks(value: unknown): Blank[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return null;
  const blanks: Blank[] = [];
  for (const blank of value) {
    if (
      !isRecord(blank) || typeof blank.id !== "string" ||
      !Array.isArray(blank.terms) || blank.terms.length === 0 ||
      !blank.terms.every((term) =>
        typeof term === "string" && term.trim() !== ""
      )
    ) return null;
    blanks.push({ id: blank.id, terms: blank.terms });
  }
  return blanks;
}

/**
 * A truth card: `front` and its `senses`, each read as the function reads a model's sense, and
 * the `examples` and `extras` its page prints for the entry as a whole, when it prints any.
 */
function parseEntry(card: unknown): Entry | null {
  if (!isRecord(card) || typeof card.front !== "string") return null;
  const senses = parseAll(card.senses, parseSense);
  const extras = card.extras === undefined
    ? undefined
    : parseAll(card.extras, parseExtra);
  const { examples } = card;
  if (
    senses === null || extras === null ||
    (examples !== undefined &&
      !(Array.isArray(examples) && examples.length > 0 &&
        examples.every((example) => typeof example === "string")))
  ) return null;
  return {
    front: card.front,
    senses,
    ...(examples === undefined ? {} : { examples }),
    ...(extras === undefined ? {} : { extras }),
  };
}

/** Each element of a non-empty list parsed, or null when any is not. */
function parseAll<T extends Sense | Extra>(
  value: unknown,
  parse: (element: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: T[] = [];
  for (const element of value) {
    const one = parse(element);
    if (one === null) return null;
    parsed.push(one);
  }
  return parsed;
}

function languages(value: unknown): LanguageHints {
  if (!isRecord(value)) return {};
  const tag = (side: unknown) =>
    typeof side === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(side)
      ? side as LanguageTag
      : undefined;
  const front = tag(value.front);
  const back = tag(value.back);
  return {
    ...(front === undefined ? {} : { front }),
    ...(back === undefined ? {} : { back }),
  };
}

/** The committed results: one table row per configuration, and the recommendation. */
export function report(
  candidates: readonly Candidate[],
  rows: readonly Row[],
  sampleCount: number,
  runUsd: number,
  ledger: Ledger,
  date: string,
  kept: { readonly replies: string; readonly halted: readonly Halt[] },
  promptLabel: string,
  outcomes: readonly Outcomes[],
): string {
  const pick = recommend(rows);
  const pct = (value: number) => (value * 100).toFixed(1);
  const pctOrNone = (value: number | null) => value === null ? "—" : pct(value);
  const lines = [
    "# Extract-cards model eval",
    "",
    "Results of `tools/eval/run.ts`: how each candidate configuration extracts cards from the sample set.",
    "",
    `- Run on ${date} with prompt ${promptLabel}, over ${sampleCount} images in \`tools/eval/samples/\`.`,
    "- The samples are synthetic: printed and handwritten-style pages rendered and distorted by `tools/eval/generate.py`, not phone photos.",
    "- Vocabulary pages: precision, recall and F1 are means of the per-image values, in percent; a card matches when its front and meaning (its answer, when it has no meaning) equal the ground truth after card key normalization.",
    "- Senses, in percent, over every card whose front matches an entry's after the same normalization: senses P is the share of returned senses equal to one of the entry's in labels and meaning, and senses R the share of the entry's senses so returned.",
    "- Over the matched cards of every image, whose senses pair with the page's in order, in percent and after the same normalization: labels P is the share of returned labels whose text equals one the page prints for that sense, and labels R the share of printed labels so returned; category is the share of those equal labels whose kind and category are the page's too; unprinted labels is the share of the senses the page prints no label for that were given one, which must be 0; examples is the share of returned examples, on the card or a sense, the page prints for the entry; sense examples is the share of the examples printed under a sense that the returned sense holds; extras is the share of printed extras returned with an equal label and text; invented is the share of returned label lists, example lists and extras where the page prints none. A dash means the configuration returned no such field, or the pages printed none.",
    '- Numbered fronts, in percent, over every returned card of the vocabulary pages: the share whose front holds a list\'s number: a numeral alone, or one opening the front before "." or ")" or in brackets, such as "1. abandon"; it must be 0 (ADR 0128). A dash means no card was returned.',
    `- Notes pages, in percent: coverage is the share of the page's facts that a card covers, its front and answer holding each of the fact's terms after the same normalization, averaged over the images; the facts are the page's rules and exceptions, and its worked examples are not facts. It equals coverage at step 5 in reports before prompt v5, whose cards carry no step. Unsupported is the share of returned cards covering no fact, which also counts a fact the model paraphrased past its terms; invented examples is the share of returned examples the page does not print, a worked example printed inside its rule's line counting as printed. Long answers is the share of returned cards whose answer lists more than ${MAX_LISTED_ITEMS} items, its parts between commas, middle dots, slashes, semicolons and line breaks, which prompt v6 splits into several cards; a table card's answer, its whole table, is not counted. Bare exceptions is the share of returned cards whose answer names an exception (${
      EXCEPTION_WORDS.map((word) => `"${word}"`).join(" or ")
    }) yet covers no fact, which prompt v7 asks every exception card to avoid by stating what the exception does. Table blanks is the share of the pages' cells to memorise that a table card asks as a blank, one blank holding each of the cell's terms, and cloze blanks the same for the words a cloze card should ask, pooled over the pages that hold any; a dash means no page held any.`,
    "- Replies: each call is instructed with the prompt and then the output contract, as the function instructs it. Invalid outputs are the images whose reply was not the schema's or kept no card, so the photo saves none; model errors are the images whose call failed; dropped cards are the cards a reply returned that broke a rule of the output contract (`CARD_RULES` in `supabase/functions/extract-cards/cards.ts`) and were left out, by the rule each broke. Cards are the cards kept over every image, and cut replies the images whose cards came from a reply cut at the output cap, the cards its JSON completed (ADR 0135).",
    "- Latency is per image, the sum of its calls; cost per image is the mean of OpenRouter's reported cost, over every image.",
    `- Every reply, its parsed cards or its error body, is kept in \`${kept.replies}/\`, which git ignores.`,
    ...kept.halted.map((halt) =>
      `- ${halt.label} stopped after ${MODEL_ERRORS_TO_STOP} model errors in a row: its row covers ${halt.ran} of ${sampleCount} images.`
    ),
    "",
    "## Models",
    "",
    ...candidates.map((candidate) =>
      `- ${candidate.label}: ${describe(candidate)}`
    ),
    "",
    "## Replies",
    "",
    "| Configuration | Images | Cards | Cut replies | Invalid outputs | Model errors | Dropped cards | Dropped by rule |",
    "|---|---|---|---|---|---|---|---|",
    ...outcomes.map((outcome) => {
      const byRule = [...outcome.dropped].sort(([a, x], [b, y]) =>
        y - x || a.localeCompare(b)
      );
      const total = byRule.reduce((sum, [, count]) => sum + count, 0);
      return `| ${outcome.label} | ${outcome.images} | ${outcome.cards} | ${outcome.cutReplies} | ${outcome.invalidOutputs} | ${outcome.modelErrors} | ${total} | ${
        byRule.length === 0
          ? "—"
          : byRule.map(([rule, count]) => `\`${rule}\` ${count}`).join(", ")
      } |`;
    }),
    "",
    "## Vocabulary pages",
    "",
    "| Configuration | Precision | Recall | F1 | Senses P | Senses R | Labels P | Labels R | Category | Unprinted labels | Examples | Sense examples | Extras | Invented | Numbered fronts | p50 latency | p90 latency | Cost per image | Total spend |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.label} | ${pct(row.precision)} | ${pct(row.recall)} | ${
        pct(row.f1)
      } | ${labelCells(row)} | ${pctOrNone(row.inventedRate)} | ${
        pctOrNone(row.numberedFrontRate)
      } | ${seconds(row.p50Ms)} | ` +
      `${seconds(row.p90Ms)} | ${usd(row.costPerImageUsd)} | ${
        usd(row.spentUsd)
      } |`
    ),
    "",
    ...vocabularyPagesSection(rows),
    ...notesSection(rows),
    ...pagesSection(rows),
    "## Recommendation",
    "",
    pick === null
      ? "- None: no configuration is within both bounds below, or none completed."
      : `- ${pick.label}: the cheapest configuration whose vocabulary F1 is within 2 points of the best and whose notes coverage is within 5 points of the best.`,
    "",
    "## Spend",
    "",
    `- This run: ${usd(runUsd)}.`,
    `- All runs: ${usd(spent(ledger))} of the ${
      usd(ledger.budgetUsd)
    } budget, recorded in \`tools/eval/spend.json\`.`,
    "",
  ];
  return lines.join("\n");
}

/** A row's senses, labels, examples and extras cells, in the vocabulary tables' order. */
function labelCells(rates: VocabularyRates): string {
  const pct = (value: number | null) =>
    value === null ? "—" : (value * 100).toFixed(1);
  return [
    rates.sensePrecision,
    rates.senseRecall,
    rates.labelPrecision,
    rates.labelRecall,
    rates.categoryAccuracy,
    rates.unprintedLabelRate,
    rates.examplesPrecision,
    rates.senseExamplesRecall,
    rates.extrasRecall,
  ].map(pct).join(" | ");
}

/**
 * Each vocabulary page's F1 and shares, one row per page and configuration, so a page written
 * for one measure, such as one printing no label, reads on its own; nothing when none ran.
 */
function vocabularyPagesSection(rows: readonly Row[]): string[] {
  if (rows.every((row) => row.vocabularyPages.length === 0)) return [];
  return [
    "## Vocabulary per page",
    "",
    "| Page | Configuration | F1 | Senses P | Senses R | Labels P | Labels R | Category | Unprinted labels | Examples | Sense examples | Extras | Numbered fronts |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.flatMap((row) =>
      row.vocabularyPages.map((page) =>
        `| ${page.name} | ${row.label} | ${(page.f1 * 100).toFixed(1)} | ${
          labelCells(page)
        } | ${
          page.numberedFrontRate === null
            ? "—"
            : (page.numberedFrontRate * 100).toFixed(1)
        } |`
      )
    ),
    "",
  ];
}

/** The notes table, one row per configuration, or nothing when no notes image ran. */
function notesSection(rows: readonly Row[]): string[] {
  if (rows.every((row) => row.notes === null)) return [];
  const pct = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : (value * 100).toFixed(1);
  return [
    "## Notes pages",
    "",
    "| Configuration | Coverage | Unsupported | Invented examples | Long answers | Bare exceptions | Table blanks | Cloze blanks |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
      const notes = row.notes;
      return `| ${row.label} | ${pct(notes?.coverage)} | ${
        pct(notes?.unsupportedRate)
      } | ${pct(notes?.inventedExamplesRate)} | ${
        pct(notes?.longAnswerRate)
      } | ${pct(notes?.bareExceptionRate)} | ${
        pct(notes?.tableBlankCoverage)
      } | ${pct(notes?.clozeBlankCoverage)} |`;
    }),
    "",
  ];
}

/**
 * The coverage of each notes page, with the completion tokens its calls used against the
 * function's output cap, one row per page and a column per configuration, or nothing when no
 * notes image ran.
 */
function pagesSection(rows: readonly Row[]): string[] {
  const names = rows.find((row) => row.notes !== null)?.notes?.pages.map((
    page,
  ) => page.name) ?? [];
  if (names.length === 0) return [];
  const pct = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : (value * 100).toFixed(1);
  return [
    "## Coverage per notes page",
    "",
    `Each cell is the page's coverage in percent, then the completion tokens of its call, against the function's \`max_tokens\` of ${MAX_OUTPUT_TOKENS} per call.`,
    "",
    `| Page | ${rows.map((row) => row.label).join(" | ")} |`,
    `|---|${rows.map(() => "---|").join("")}`,
    ...names.map((name) =>
      `| ${name} | ${
        rows.map((row) => {
          const page = row.notes?.pages.find((page) => page.name === name);
          return page === undefined
            ? "—"
            : `${pct(page.coverage)} · ${page.completionTokens} tokens`;
        }).join(" | ")
      } |`
    ),
    "",
  ];
}

function describe(candidate: Candidate): string {
  const model = (m: Model) =>
    `\`${m.id}\` (${usd(m.pricing.prompt * 1e6)}/M prompt, ${
      usd(m.pricing.completion * 1e6)
    }/M completion)`;
  return model(candidate.primary);
}

const usd = (value: number) => `$${value.toFixed(4)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The eval's real I/O, as the command in this file's header runs it. A write creates its
 * directory only when the directory is missing, so writing `spend.json` needs no grant beyond
 * that file.
 */
export function denoIo(): Io {
  return {
    fetch,
    now: () => performance.now(),
    env: (name) => Deno.env.get(name),
    readText: (path) => Deno.readTextFile(path),
    readBytes: (path) => Deno.readFile(path),
    list: async (dir) =>
      (await Array.fromAsync(Deno.readDir(dir))).map((entry) => entry.name),
    writeText: async (path, text) => {
      try {
        await Deno.writeTextFile(path, text);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(path, text);
      }
    },
    print: (line) => console.log(line),
    today: () => new Date().toISOString().slice(0, 10),
    startedAt: () => new Date().toISOString(),
  };
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args, denoIo()));
}
