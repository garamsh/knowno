/**
 * The function's own way of reading a photo, read on to the page's end as the function and its
 * clients do (ADR 0138), and the two ways the eval measured against it (ADR 0135): a leaner reply
 * shape and a higher output cap, neither deployed.
 */

import {
  CARD_RULES,
  cardsSchema,
  OUTPUT_CONTRACT,
  type ParsedReply,
  parseReply,
} from "../../supabase/functions/extract-cards/cards.ts";
import {
  lastFronts,
  MAX_CONTINUATIONS,
  readOn,
  readsOn,
} from "../../supabase/functions/extract-cards/continuation.ts";
import {
  CARD_LIST,
  extractCards,
  type ExtractDeps,
  type Extraction,
  MAX_OUTPUT_TOKENS,
  type ModelId,
  type ReplyForm,
} from "../../supabase/functions/extract-cards/model.ts";
import type {
  Image,
  LanguageHints,
} from "../../supabase/functions/extract-cards/request.ts";
/** One way of reading a photo: its label, the most calls and reply tokens an image may take. */
export type Alternative = {
  readonly label: string;
  readonly calls: number;
  readonly maxTokens: number;
  readonly extract: (
    image: Image,
    languages: LanguageHints,
    model: ModelId,
    prompt: string,
    deps: ExtractDeps,
  ) => Promise<Extraction>;
};

const card = cardsSchema.properties.cards.items;
const sense = card.properties.senses.items;

/**
 * The card list's schema with every field a card may leave empty optional: only `kind`, `front`
 * and `topic` are required on a card, and only `meaning` on a sense.
 */
export const leanSchema = {
  ...cardsSchema,
  properties: {
    cards: {
      ...cardsSchema.properties.cards,
      items: {
        ...card,
        properties: {
          ...card.properties,
          senses: {
            ...card.properties.senses,
            items: { ...sense, required: ["meaning"] },
          },
        },
        required: ["kind", "front", "topic"],
      },
    },
  },
};

/** The rule that replaces `CARD_RULES.fields` in the lean contract. */
export const LEAN_FIELDS_RULE =
  `A card holds only the fields above, each at most once, and leaves out every field it does not use: "type" when it is "concept", an "answer", "pronunciation", "table" or "cloze" that is null, and every empty list, a sense's empty "labels" and "examples" included.`;

/** The output contract with the lean rule for the fields a card leaves out. */
export const LEAN_CONTRACT = OUTPUT_CONTRACT
  .replace("Every card has these fields:", "A card may have these fields:")
  .replace(CARD_RULES.fields, LEAN_FIELDS_RULE);

/** What a field a lean card leaves out stands for. */
const CARD_DEFAULTS = {
  type: "concept",
  answer: null,
  senses: [],
  extras: [],
  pronunciation: null,
  examples: [],
  table: null,
  cloze: null,
};
const SENSE_DEFAULTS = { labels: [], examples: [] };

/**
 * A lean reply read by the card list's rules: each card's left-out fields filled with what they
 * stand for, then `parseReply`. Null when it is not JSON of `{cards: [...]}`.
 */
export function parseLeanReply(reply: string): ParsedReply | null {
  let value: unknown;
  try {
    value = JSON.parse(reply);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.cards)) return null;
  const cards = value.cards.map((item: unknown) => {
    if (!isRecord(item)) return item;
    const filled: Record<string, unknown> = { ...CARD_DEFAULTS, ...item };
    if (Array.isArray(filled.senses)) {
      filled.senses = filled.senses.map((one: unknown) =>
        isRecord(one) ? { ...SENSE_DEFAULTS, ...one } : one
      );
    }
    return filled;
  });
  return parseReply(JSON.stringify({ ...value, cards }));
}

export const LEAN_LIST: ReplyForm = {
  schema: leanSchema,
  contract: LEAN_CONTRACT,
  parse: parseLeanReply,
  maxTokens: MAX_OUTPUT_TOKENS,
};

/**
 * The higher cap: the PM's probe of 2026-11-01 measured about 320 output tokens a second, so a reply
 * of 19,200 tokens ends at the 60 s model timeout; 18,000 leaves the prompt's reading about 4 s.
 */
export const HIGHER_CAP_TOKENS = 18_000;

/**
 * The function's call, then, when its reply was cut, the calls that read on after it until the page
 * is done, as the function goes on within a request and its client with each cursor after it: with
 * no time budget, the most continuing calls a photo may make, and a failed call asked again once.
 */
export async function extractWhole(
  image: Image,
  languages: LanguageHints,
  model: ModelId,
  prompt: string,
  deps: ExtractDeps,
): Promise<Extraction> {
  const first = await extractCards(image, languages, model, prompt, deps);
  if (first.kind !== "cards" || !readsOn(first.cut, first.cards.length)) {
    return first;
  }
  const on = await readOn(
    (followUp) =>
      extractCards(image, languages, model, prompt, deps, { followUp }),
    {
      read: first.cards.length,
      fronts: lastFronts(first.cards.map((card) => card.front)),
      calls: MAX_CONTINUATIONS,
    },
    () => true,
  );
  return {
    kind: "cards",
    cards: [...first.cards, ...on.cards],
    dropped: [...first.dropped, ...on.dropped],
    cut: !on.done,
    attempts: [...first.attempts, ...on.attempts],
  };
}

/** The function's own way, and the two ways `--alternatives` may name beside it. */
export const ALTERNATIVES: readonly Alternative[] = [
  {
    label: "today",
    calls: 1 + MAX_CONTINUATIONS,
    maxTokens: MAX_OUTPUT_TOKENS,
    extract: extractWhole,
  },
  {
    label: "lean",
    calls: 1,
    maxTokens: MAX_OUTPUT_TOKENS,
    extract: (image, languages, model, prompt, deps) =>
      extractCards(image, languages, model, prompt, deps, { form: LEAN_LIST }),
  },
  {
    label: "cap",
    calls: 1,
    maxTokens: HIGHER_CAP_TOKENS,
    extract: (image, languages, model, prompt, deps) =>
      extractCards(image, languages, model, prompt, deps, {
        form: { ...CARD_LIST, maxTokens: HIGHER_CAP_TOKENS },
      }),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
