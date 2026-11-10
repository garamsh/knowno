/**
 * The AI layer of a note's screening (ADR 0239): what of the note goes to a model, how a cheap
 * model and then a strong one judge it, and the verdict they leave. It reads the settings in
 * force, calls the model through [Judge] and never keeps or logs the note's text: the findings
 * it answers name where a model looked, by card hash and place, never what was there.
 */

import {
  chatReply,
  chatUsage,
  OPENROUTER_URL,
} from "../../extract-cards/providers.ts";
import type { Usage } from "../../extract-cards/model.ts";
import { type Claim, type Finding, segments } from "./rules.ts";

/** A verdict version that no stored verdict is reused as: the AI layer could not decide. */
export const UNAVAILABLE = "unavailable";

/** The version a verdict of settings [id] is stored under. */
export const aiVersion = (id: number) => `ai:${id}`;

/** Whether a stored verdict [version] is a decision to reuse for the same content. */
export const isDecided = (version: unknown) =>
  typeof version === "string" && version.startsWith("ai:");

/** The categories a model may flag, as the prompt names them. */
export const CATEGORIES = [
  "personal_data",
  "spam",
  "sexual",
  "hate",
  "violence",
  "illegal_trade",
  "self_harm",
  "harassment",
] as const;
export type AiCategory = (typeof CATEGORIES)[number];

/** `private.screening_settings`' row in force, as `public.screening_ai_state` answers it. */
export type Settings = {
  readonly id: number;
  readonly cheapModel: string;
  readonly strongModel: string;
  readonly confidenceFloor: number;
  readonly sampleCards: number;
  readonly maxInputTokens: number;
  readonly maxImages: number;
  readonly dailyCapUsd: number;
  readonly assumedCallUsd: number;
  readonly prompt: string;
};
export type AiState = {
  readonly settings: Settings;
  readonly spentUsd: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The state `public.screening_ai_state` answered, or null for any other shape. */
export function parseState(value: unknown): AiState | null {
  if (!isRecord(value) || !isRecord(value.settings)) return null;
  const s = value.settings;
  const spent = Number(value.spent_usd);
  const numbers = [
    s.id,
    s.confidence_floor,
    s.sample_cards,
    s.max_input_tokens,
    s.max_images,
    s.daily_cap_usd,
    s.assumed_call_usd,
  ].map(Number);
  if (
    typeof s.cheap_model !== "string" || typeof s.strong_model !== "string" ||
    typeof s.prompt !== "string" || !Number.isFinite(spent) ||
    numbers.some((n) => !Number.isFinite(n))
  ) return null;
  const [id, floor, cards, tokens, images, cap, assumed] = numbers;
  return {
    settings: {
      id,
      cheapModel: s.cheap_model,
      strongModel: s.strong_model,
      confidenceFloor: floor,
      sampleCards: cards,
      maxInputTokens: tokens,
      maxImages: images,
      dailyCapUsd: cap,
      assumedCallUsd: assumed,
      prompt: s.prompt,
    },
    spentUsd: spent,
  };
}

/** One numbered part of a note a model reads: a string, or a photo that follows as an image. */
export type Item = {
  readonly n: number;
  readonly kind: "text" | "photo";
  readonly card: string | null;
  readonly where: Finding["where"];
  readonly text: string;
  /** The photo's media id, for a photo. */
  readonly media: string | null;
};

/** What goes to the model: the items, bounded by the settings. */
export type Payload = { readonly items: readonly Item[] };

/** A rough count of tokens in [text]: one for every two characters, high for Korean and English alike. */
const tokensOf = (text: string) => Math.ceil(text.length / 2);

/** A generator of the numbers [0, 1) that the same [seed] always gives in the same order. */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The note's name and description, then the cards the rules flagged, then a fixed random
 * sample of the others (the same one for the same [hash]), until the token cap or the sample
 * size is reached. A card goes whole or not at all. Photos are kept up to the settings' cap.
 */
export function buildPayload(
  claim: Claim,
  flagged: ReadonlySet<string>,
  hash: string,
  settings: Settings,
): Payload {
  const all = segments(claim);
  const items: Item[] = [];
  let used = tokensOf(settings.prompt);
  let photos = 0;
  const push = (item: Omit<Item, "n">) => {
    items.push({ ...item, n: items.length });
  };
  for (const segment of all.filter((s) => s.card === null)) {
    const text = segment.text.slice(0, 2000);
    used += tokensOf(text);
    push({
      kind: "text",
      card: null,
      where: segment.where,
      text,
      media: null,
    });
  }
  const random = seeded(hash);
  const others = claim.cards.filter((c) => !flagged.has(c.hash))
    .map((card) => ({ card, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, settings.sampleCards)
    .map((x) => x.card);
  const chosen = [
    ...claim.cards.filter((c) => flagged.has(c.hash)),
    ...others,
  ];
  for (const card of chosen) {
    const parts = all.filter((s) => s.card === card.hash);
    const cost = parts.reduce((sum, s) => sum + tokensOf(s.text), 0);
    if (used + cost > settings.maxInputTokens) continue;
    used += cost;
    for (const part of parts) {
      push({
        kind: "text",
        card: card.hash,
        where: part.where,
        text: part.text,
        media: null,
      });
    }
    for (const where of ["front", "back"] as const) {
      const blocks = card[where];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (
          photos < settings.maxImages && isRecord(block) &&
          block.type === "image" && isRecord(block.payload) &&
          typeof block.payload.media === "string"
        ) {
          photos++;
          push({
            kind: "photo",
            card: card.hash,
            where,
            text: "",
            media: block.payload.media,
          });
        }
      }
    }
  }
  return { items };
}

/** A model's reading of the note. */
export type Reply = {
  readonly verdict: "clean" | "severe" | "unsure";
  readonly confidence: number;
  readonly flags: readonly {
    readonly item: number;
    readonly category: AiCategory;
  }[];
  /** What the provider reported for the call, null when it reported none. */
  readonly usage: Usage | null;
};

/** One model call. Answers null when the model could not be reached or answered no usable verdict. */
export type Judge = (request: {
  readonly model: string;
  readonly prompt: string;
  readonly payload: Payload;
  /** Each photo item's bytes as a data URL, by item number. */
  readonly images: ReadonlyMap<number, string>;
}) => Promise<Reply | null>;

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "flags"],
  properties: {
    verdict: { type: "string", enum: ["clean", "severe", "unsure"] },
    confidence: { type: "number" },
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "category"],
        properties: {
          item: { type: "integer" },
          category: { type: "string", enum: CATEGORIES },
        },
      },
    },
  },
};

/** How long one call may take before it is abandoned. */
export const JUDGE_TIMEOUT_MS = 30_000;
const MAX_REPLY_TOKENS = 400;

/** A model's reply text as a [Reply] over [payload]'s items, or null for anything else. */
export function parseReply(
  text: string,
  payload: Payload,
  usage: Usage | null,
): Reply | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.flags)) return null;
  const { verdict, confidence } = value;
  if (
    (verdict !== "clean" && verdict !== "severe" && verdict !== "unsure") ||
    typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)
  ) return null;
  const flags: { item: number; category: AiCategory }[] = [];
  for (const flag of value.flags) {
    if (!isRecord(flag)) return null;
    const { item, category } = flag;
    const known = CATEGORIES.find((c) => c === category);
    if (
      typeof item !== "number" || !Number.isInteger(item) ||
      item < 0 || item >= payload.items.length || known === undefined
    ) return null;
    flags.push({ item, category: known });
  }
  return { verdict, confidence, flags, usage };
}

/** The [Judge] that asks OpenRouter with [apiKey]; the same path as the card extraction's. */
export function openRouterJudge(
  deps: { readonly fetch: typeof fetch; readonly apiKey: string },
): Judge {
  return async (request) => {
    const content: unknown[] = [{
      type: "text",
      text: JSON.stringify({
        items: request.payload.items.map((i) => ({
          n: i.n,
          kind: i.kind,
          where: i.where,
          ...(i.kind === "text" ? { text: i.text } : {}),
        })),
      }),
    }];
    for (const item of request.payload.items) {
      const url = request.images.get(item.n);
      if (item.kind === "photo" && url !== undefined) {
        content.push({ type: "image_url", image_url: { url } });
      }
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), JUDGE_TIMEOUT_MS);
    try {
      const response = await deps.fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${deps.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.prompt },
            { role: "user", content },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "screening",
              strict: true,
              schema: REPLY_SCHEMA,
            },
          },
          provider: { require_parameters: true },
          usage: { include: true },
          max_tokens: MAX_REPLY_TOKENS,
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const body: unknown = await response.json();
      const text = chatReply(body);
      return text === null || text.cut
        ? null
        : parseReply(text.text, request.payload, chatUsage(body));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Where a model looked: no offsets, as a model reads items rather than characters. */
export type AiFinding = {
  readonly card: string | null;
  readonly where: Finding["where"];
  readonly block: null;
  readonly field: null;
  readonly category: AiCategory;
  readonly start: null;
  readonly end: null;
};

/** The AI layer's verdict: what to record, and why it could not decide when it did not. */
export type Decision = {
  readonly outcome: "clean" | "severe" | "unsure";
  readonly findings: readonly AiFinding[];
  readonly version: string;
  /** Null when a model decided; otherwise why none did. */
  readonly unavailable: "no_settings" | "no_key" | "capped" | "failed" | null;
};

export const unavailableDecision = (
  why: NonNullable<Decision["unavailable"]>,
): Decision => ({
  outcome: "unsure",
  findings: [],
  version: UNAVAILABLE,
  unavailable: why,
});

/** One call as the cap and the record see it. */
export type Spend = {
  readonly tier: "cheap" | "strong";
  readonly model: string;
  readonly usage: Usage | null;
  readonly costUsd: number;
};

/**
 * Judges the note: the cheap model first, and the strong one only when the first is unsure or
 * under the confidence floor. A verdict under the floor from the strong model is unsure. No call
 * is made once the day's spend has reached the cap, the strong one included; a call that reported
 * no cost is charged the settings' assumed price. [spend] is told of each call.
 */
export async function judgeNote(input: {
  readonly state: AiState;
  readonly payload: Payload;
  readonly judge: Judge;
  readonly images: ReadonlyMap<number, string>;
  readonly spend: (call: Spend) => Promise<void>;
}): Promise<Decision> {
  const { settings } = input.state;
  let spent = input.state.spentUsd;
  const findingsOf = (reply: Reply): AiFinding[] =>
    reply.flags.map((flag) => {
      const item = input.payload.items[flag.item];
      return {
        card: item.card,
        where: item.where,
        block: null,
        field: null,
        category: flag.category,
        start: null,
        end: null,
      };
    });
  let last: Reply | null = null;
  for (
    const [tier, model] of [
      ["cheap", settings.cheapModel],
      ["strong", settings.strongModel],
    ] as const
  ) {
    if (spent >= settings.dailyCapUsd) return unavailableDecision("capped");
    const reply = await input.judge({
      model,
      prompt: settings.prompt,
      payload: input.payload,
      images: input.images,
    });
    const costUsd = reply?.usage?.costUsd ?? settings.assumedCallUsd;
    spent += costUsd;
    await input.spend({ tier, model, usage: reply?.usage ?? null, costUsd });
    if (reply === null) return unavailableDecision("failed");
    last = reply;
    if (
      reply.verdict !== "unsure" && reply.confidence >= settings.confidenceFloor
    ) {
      return {
        outcome: reply.verdict,
        findings: reply.verdict === "clean" ? [] : findingsOf(reply),
        version: aiVersion(settings.id),
        unavailable: null,
      };
    }
  }
  return {
    outcome: "unsure",
    findings: last === null ? [] : findingsOf(last),
    version: aiVersion(settings.id),
    unavailable: null,
  };
}
