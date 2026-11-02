/** Resolves each candidate configuration to exact OpenRouter model IDs from the live model list. */

import {
  type ModelId,
  modelId,
} from "../../supabase/functions/extract-cards/model.ts";

export const MODELS_URL = "https://openrouter.ai/api/v1/models";

/** A candidate as `candidates.json` states it: a pattern matched against model IDs. */
export type Selector = {
  readonly label: string;
  readonly primary: string;
};

/**
 * USD per token for prompt and completion, and per image and per request; and per prompt token
 * read from or written to the prompt cache, the prompt's price where the list names none.
 */
export type Pricing = {
  readonly prompt: number;
  readonly completion: number;
  readonly image: number;
  readonly request: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export type Model = {
  readonly id: ModelId;
  readonly created: number;
  readonly pricing: Pricing;
};

/** A candidate with the exact model ID it runs, as recorded in the results. */
export type Candidate = {
  readonly label: string;
  readonly primary: Model;
};

/**
 * The models from OpenRouter's list that take image input and support structured outputs,
 * the two things extract-cards needs. Entries of any other shape are left out.
 */
export function parseModels(body: unknown): Model[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error("the model list has no data array");
  }
  return body.data.flatMap((entry: unknown): Model[] => {
    if (
      !isRecord(entry) || typeof entry.id !== "string" ||
      typeof entry.created !== "number"
    ) return [];
    const id = modelId("openrouter", entry.id);
    const inputs = isRecord(entry.architecture)
      ? entry.architecture.input_modalities
      : undefined;
    const parameters = entry.supported_parameters;
    if (id === null || !Array.isArray(inputs) || !inputs.includes("image")) {
      return [];
    }
    if (
      !Array.isArray(parameters) || !parameters.includes("structured_outputs")
    ) return [];
    const pricing = parsePricing(entry.pricing);
    return pricing === null ? [] : [{ id, created: entry.created, pricing }];
  });
}

function parsePricing(value: unknown): Pricing | null {
  if (!isRecord(value)) return null;
  const price = (name: string) => {
    const raw = value[name];
    if (raw === undefined) return 0;
    const number = typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const [prompt, completion, image, request, cacheRead, cacheWrite] = [
    "prompt",
    "completion",
    "image",
    "request",
    "input_cache_read",
    "input_cache_write",
  ].map(price);
  if (
    prompt === null || completion === null || image === null ||
    request === null || cacheRead === null || cacheWrite === null
  ) return null;
  return {
    prompt,
    completion,
    image,
    request,
    cacheRead: value.input_cache_read === undefined ? prompt : cacheRead,
    cacheWrite: value.input_cache_write === undefined ? prompt : cacheWrite,
  };
}

/** The newest model, by the date OpenRouter added it, whose whole ID matches the pattern. */
export function newest(
  pattern: string,
  models: readonly Model[],
): Model | null {
  const regex = new RegExp(pattern);
  const matches = models.filter((model) => regex.test(model.id));
  return matches.reduce<Model | null>(
    (pick, model) =>
      pick === null || model.created > pick.created ? model : pick,
    null,
  );
}

/** Every selector resolved, or the labels of those whose pattern matched no usable model. */
export function resolve(
  selectors: readonly Selector[],
  models: readonly Model[],
): { readonly ok: true; readonly candidates: Candidate[] } | {
  readonly ok: false;
  readonly unresolved: string[];
} {
  const candidates: Candidate[] = [];
  const unresolved: string[] = [];
  for (const selector of selectors) {
    const primary = newest(selector.primary, models);
    if (primary === null) unresolved.push(selector.label);
    else candidates.push({ label: selector.label, primary });
  }
  return unresolved.length > 0
    ? { ok: false, unresolved }
    : { ok: true, candidates };
}

export function parseSelectors(value: unknown): Selector[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("candidates.json holds no candidate list");
  }
  return value.map((entry: unknown) => {
    // A retry is refused: the function makes one call per photo (ADR 0071).
    if (
      !isRecord(entry) || typeof entry.label !== "string" ||
      typeof entry.primary !== "string" || entry.retry !== undefined
    ) {
      throw new Error(
        `candidates.json holds a malformed candidate: ${JSON.stringify(entry)}`,
      );
    }
    return { label: entry.label, primary: entry.primary };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
