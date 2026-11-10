/**
 * The triage-reports HTTP handler (ADR 0244). `POST /work` is the scheduler's, with the service-role
 * key: it judges the notes the database says are due, a cheap model first and a strong one only when
 * unsure, and hands every verdict to `record_triage`, where the database decides what it does.
 * Every model call is charged to the spend ledger by `record_triage_spend`, a failed or unreadable
 * one too, and no call is made once the day's cap is closed; the lease and the backoff of a note
 * are the database's, told by `triage_release`.
 * `POST /settings/configuration` is an admin saving the providers, models, prices and prompt as the
 * draft, after one check call per tier parsed. Nothing here logs or stores a note's text: the log
 * holds ids, a route, an outcome and counts.
 */

import {
  authenticate,
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import { type Provider, PROVIDERS, vaultKeys } from "../_shared/keys.ts";
import { same } from "../_shared/same.ts";
import type { Config } from "./config.ts";
import {
  buildPayload,
  bytes,
  instructions,
  locate,
  MAX_FIELD,
  MAX_PASSAGE,
  parseReply,
  type Reply,
  type TriageClaim,
} from "./payload.ts";
import { type Answer, ask, MAX_ANSWER_TOKENS } from "./provider.ts";

export type Deps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly log: (entry: Record<string, unknown>) => void;
};

/** The most notes one `/work` call asks the database for. */
export const WORK_BATCH = 10;
/** No new note starts after this long into a `/work` call, so it ends inside the function's limit. */
export const WORK_LIMIT_MS = 90_000;
/** How long one model call may take. */
export const CALL_TIMEOUT_MS = 20_000;

type Tier = {
  readonly provider: Provider;
  readonly model: string;
  readonly inUsd: number;
  readonly outUsd: number;
};

/** The active configuration `triage_claim` carries. */
export type Configuration = {
  readonly id: number;
  readonly cheap: Tier;
  readonly strong: Tier;
  readonly prompt: string;
  readonly escalateBelow: number;
  readonly payloadTokens: number;
  readonly sampleCards: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const parseProvider = (value: unknown): Provider | null =>
  PROVIDERS.find((known) => known === value) ?? null;

/** The configuration of a claim's `configuration`, or null when it is not as the database writes it. */
export function readConfiguration(value: unknown): Configuration | null {
  if (!isRecord(value)) return null;
  const tier = (which: "cheap" | "strong"): Tier | null => {
    const provider = parseProvider(value[`${which}_provider`]);
    const model = value[`${which}_model`];
    const inUsd = Number(value[`${which}_in_usd`]);
    const outUsd = Number(value[`${which}_out_usd`]);
    return provider === null || typeof model !== "string" ||
        !Number.isFinite(inUsd) || !Number.isFinite(outUsd)
      ? null
      : { provider, model, inUsd, outUsd };
  };
  const cheap = tier("cheap");
  const strong = tier("strong");
  const escalateBelow = Number(value.escalate_below);
  const payloadTokens = Number(value.payload_tokens);
  const sampleCards = Number(value.sample_cards);
  if (
    cheap === null || strong === null || typeof value.id !== "number" ||
    typeof value.prompt !== "string" || !Number.isFinite(escalateBelow) ||
    !Number.isFinite(payloadTokens) || !Number.isFinite(sampleCards)
  ) return null;
  return {
    id: value.id,
    cheap,
    strong,
    prompt: value.prompt,
    escalateBelow,
    payloadTokens,
    sampleCards,
  };
}

/** What a call cost: the provider's own figure, else its tokens at the tier's prices per million. */
export function costOf(
  tier: Tier,
  answer: { tokensIn: number; tokensOut: number; costUsd: number | null },
): number {
  return answer.costUsd ??
    (answer.tokensIn * tier.inUsd + answer.tokensOut * tier.outUsd) / 1e6;
}

/** What a call is charged to the ledger. */
export type Charge = {
  readonly costUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** True when the figure is the most the call could have cost, not what the provider reported. */
  readonly estimated: boolean;
};

/**
 * The most a call can cost: every byte of the request a token in, and a full answer out. A
 * tokenizer makes at most one token of a byte, so this bounds what the provider can bill.
 */
export function ceilingOf(tier: Tier, requestBytes: number): Charge {
  return {
    costUsd: costOf(tier, {
      tokensIn: requestBytes,
      tokensOut: MAX_ANSWER_TOKENS,
      costUsd: null,
    }),
    tokensIn: requestBytes,
    tokensOut: MAX_ANSWER_TOKENS,
    estimated: true,
  };
}

/**
 * What [answer] is charged, null when nothing was spent: the reported cost, else the reported
 * tokens at the tier's prices, else the ceiling when the reply omits its usage or the call may have
 * run without telling (unreachable, timed out, an unreadable body); a refusal with an error status
 * cost nothing.
 */
export function chargeOf(
  tier: Tier,
  answer: Answer,
  requestBytes: number,
): Charge | null {
  if (answer.kind === "failed") {
    return answer.status === null || answer.status < 400
      ? ceilingOf(tier, requestBytes)
      : null;
  }
  const { tokensIn, tokensOut, costUsd } = answer;
  if (costUsd === null && (tokensIn === null || tokensOut === null)) {
    return ceilingOf(tier, requestBytes);
  }
  return {
    costUsd: costOf(tier, {
      tokensIn: tokensIn ?? 0,
      tokensOut: tokensOut ?? 0,
      costUsd,
    }),
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    estimated: false,
  };
}

type Keys = {
  readonly url: string;
  readonly key: string;
  readonly bearer: string;
};

export function createHandler(
  deps: Deps,
): (request: Request) => Promise<Response> {
  const keys = deps.config.kind === "configured"
    ? vaultKeys({
      url: deps.config.supabaseUrl,
      serviceRoleKey: deps.config.serviceRoleKey,
      fetch: deps.fetch,
      now: deps.now,
    })
    : null;
  return async (request) => {
    const route = new URL(request.url).pathname.replace(/\/+$/, "");
    const kind = route.endsWith("/work")
      ? "work"
      : route.endsWith("/settings/configuration")
      ? "configuration"
      : null;
    const reply = (status: number, outcome: string, body?: unknown) => {
      deps.log({ route: kind, outcome, status });
      return body === undefined
        ? new Response(null, { status })
        : Response.json(body, { status });
    };
    if (kind === null) return reply(404, "not_found", { error: "not_found" });
    if (request.method !== "POST") {
      deps.log({ route: kind, outcome: "method_not_allowed" });
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const config = deps.config;
    if (config.kind === "not_configured" || keys === null) {
      return reply(503, "not_configured", { error: "not_configured" });
    }
    const supabase: SupabaseDeps = {
      url: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      fetch: deps.fetch,
    };
    const service: Keys = {
      url: config.supabaseUrl,
      key: config.serviceRoleKey,
      bearer: config.serviceRoleKey,
    };
    try {
      if (kind === "work") {
        const bearer = request.headers.get("Authorization")?.match(
          /^Bearer (\S+)$/,
        )?.[1];
        if (
          bearer === undefined || !(await same(bearer, config.serviceRoleKey))
        ) {
          return reply(401, "unauthenticated", { error: "unauthenticated" });
        }
        const body: unknown = await request.json().catch(() => null);
        const severe = isRecord(body) && body.severe === true;
        const outcomes = await work(severe, service, keys, deps);
        deps.log({ route: "work", outcome: "worked", severe, outcomes });
        return Response.json({ outcomes });
      }
      const settings = await saveConfiguration(
        request,
        supabase,
        service,
        keys,
        deps,
      );
      return reply(settings.status, settings.code, settings.body);
    } catch (error) {
      if (!(error instanceof SupabaseError)) throw error;
      deps.log({ route: kind, outcome: "supabase_error" });
      return Response.json({ error: "unavailable" }, { status: 502 });
    }
  };
}

type Keyring = ReturnType<typeof vaultKeys>;

/**
 * Judges the due notes, at most `WORK_BATCH`, and counts what happened to each. A note whose
 * judging fails is released with a failure, which the database backs off from, and one failure
 * leaves the others their turn.
 */
async function work(
  severe: boolean,
  service: Keys,
  keys: Keyring,
  deps: Deps,
): Promise<Record<string, number>> {
  const started = deps.now();
  const due = await call(service, deps, "triage_due", {
    max_notes: WORK_BATCH,
    severe_only: severe,
  });
  const ids = Array.isArray(due)
    ? due.flatMap((row: unknown) =>
      isRecord(row) && typeof row.deck_id === "string" ? [row.deck_id] : []
    )
    : [];
  const outcomes: Record<string, number> = {};
  for (const id of ids) {
    if (deps.now() - started >= WORK_LIMIT_MS) {
      outcomes.deferred = (outcomes.deferred ?? 0) + 1;
      continue;
    }
    const outcome = await judge(id, service, keys, deps).catch(async () => {
      deps.log({ route: "work", deck: id, outcome: "failed" });
      await release(service, deps, id, true).catch(() => undefined);
      return "failed";
    });
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return outcomes;
}

/** Gives up the lease on [deckId], with a failure when [failed]; the database backs off from one. */
async function release(
  service: Keys,
  deps: Deps,
  deckId: string,
  failed: boolean,
): Promise<void> {
  await call(service, deps, "triage_release", {
    deck_id: deckId,
    failed,
  });
}

/** A parsed reply and the tier that gave it. */
type Verdict = {
  readonly reply: Reply;
  readonly tier: "cheap" | "strong";
  readonly model: Tier;
};

/**
 * Judges one note: claims it, asks the cheap model, asks the strong one only when the cheap one
 * is unsure and the day's cap is still open, and records the verdict. Each call is charged to the
 * ledger at once. Answers `record_triage`'s word, `skipped` for a note that is no longer due,
 * `no_key` while a tier's provider has none, `failed` when no model answered and `capped` when the
 * cap closed on a reply that could not be read; the last two release the lease, `failed` with a
 * failure.
 */
export async function judge(
  deckId: string,
  service: Keys,
  keys: Keyring,
  deps: Deps,
): Promise<string> {
  const claimed = await call(service, deps, "triage_claim", {
    deck_id: deckId,
  });
  if (!isRecord(claimed) || typeof claimed.hash !== "string") return "skipped";
  const configuration = readConfiguration(claimed.configuration);
  if (configuration === null) return "skipped";
  const claim = claimed as unknown as TriageClaim;
  const payload = await buildPayload(
    claim,
    configuration.payloadTokens,
    configuration.sampleCards,
  );
  const system = instructions(configuration.prompt);
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let open = true;
  const attempt = async (
    which: "cheap" | "strong",
  ): Promise<Verdict | "no_key" | "failed" | "unparsed"> => {
    const tier = configuration[which];
    const key = await keys.get(tier.provider);
    if (key === null) return "no_key";
    const answer: Answer = await ask({
      provider: tier.provider,
      model: tier.model,
      key,
      instructions: system,
      user: payload.text,
      fetch: deps.fetch,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const charge = chargeOf(tier, answer, bytes(system) + bytes(payload.text));
    if (charge !== null) {
      const stays = await call(service, deps, "record_triage_spend", {
        deck_id: deckId,
        content_hash: claim.hash,
        tier: which,
        provider: tier.provider,
        model: tier.model,
        tokens_in: charge.tokensIn,
        tokens_out: charge.tokensOut,
        cost_usd: Math.round(charge.costUsd * 1e6) / 1e6,
        estimated: charge.estimated,
      });
      open = stays === true;
    }
    if (answer.kind === "failed") return "failed";
    if (charge !== null) {
      tokensIn += charge.tokensIn;
      tokensOut += charge.tokensOut;
      cost += charge.costUsd;
    }
    const reply = parseReply(answer.text);
    return reply === null ? "unparsed" : { reply, tier: which, model: tier };
  };
  const cheap = await attempt("cheap");
  if (cheap === "no_key" || cheap === "failed") {
    await release(service, deps, deckId, cheap === "failed");
    return cheap;
  }
  let chosen: Verdict | null = cheap === "unparsed" ? null : cheap;
  let escalated = false;
  if (
    chosen === null || chosen.reply.confidence < configuration.escalateBelow ||
    chosen.reply.category === "other"
  ) {
    if (!open) {
      if (chosen === null) {
        await release(service, deps, deckId, false);
        return "capped";
      }
    } else {
      escalated = true;
      const strong = await attempt("strong");
      if (strong !== "no_key" && strong !== "failed" && strong !== "unparsed") {
        chosen = strong;
      } else if (chosen === null && strong === "failed") {
        await release(service, deps, deckId, true);
        return "failed";
      }
    }
  }
  const place = chosen === null
    ? null
    : locate(chosen.reply.passage, payload.places);
  const recorded = await call(service, deps, "record_triage", {
    deck_id: deckId,
    content_hash: claim.hash,
    category: chosen === null ? "unjudged" : chosen.reply.category,
    confidence: chosen === null ? 0 : chosen.reply.confidence,
    passage: chosen?.reply.passage?.slice(0, MAX_PASSAGE) ?? null,
    field: place === null ? null : place.field.slice(0, MAX_FIELD),
    card_hash: place?.card ?? null,
    tier: chosen === null ? "cheap" : chosen.tier,
    provider: (chosen?.model ?? configuration.cheap).provider,
    model: (chosen?.model ?? configuration.cheap).model,
    configuration_id: configuration.id,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: Math.round(cost * 1e6) / 1e6,
    escalated,
  });
  return typeof recorded === "string" ? recorded : "unknown";
}

/** How the settings request ended: the status, the code the logs and the body carry, and the body. */
type Settled = { status: number; code: string; body: unknown };

const failure = (status: number, code: string): Settled => ({
  status,
  code,
  body: { error: code },
});

/** The words of the check call that name why a tier did not answer a parsable verdict. */
function checkFailure(answer: Answer): string | null {
  if (answer.kind === "failed") {
    if (answer.status === 401 || answer.status === 403) return "key_refused";
    if (answer.status === 404) return "model_not_found";
    return "call_failed";
  }
  return parseReply(answer.text) === null ? "bad_output" : null;
}

const CHECK_NOTE = [
  "<note>",
  '{"at":"name","text":"Spring sale"}',
  '{"at":"description","text":"Buy two get one free at our shop."}',
  "</note>",
].join("\n");

function numberIn(value: unknown, low: number, high: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= low &&
      value <= high
    ? value
    : null;
}

/**
 * Saves the admin's configuration as the draft, after one call per tier parsed: the caller is an
 * admin signed in recently, both providers have a key in Vault, and each tier answered the contract.
 */
async function saveConfiguration(
  request: Request,
  supabase: SupabaseDeps,
  service: Keys,
  keys: Keyring,
  deps: Deps,
): Promise<Settled> {
  const authorization = request.headers.get("Authorization");
  const id: UserId | null = await authenticate(authorization, supabase);
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (id === null || token === undefined) {
    return failure(401, "unauthenticated");
  }
  const session = await adminSession(token, supabase);
  if (session === "not_admin") return failure(403, "forbidden");
  if (session === "stale") return failure(403, "reauth");
  const value: unknown = await request.json().catch(() => null);
  const tiers = isRecord(value)
    ? [value.cheap, value.strong].map(readTier)
    : [];
  const [cheap, strong] = tiers;
  const prompt = isRecord(value) && typeof value.prompt === "string"
    ? value.prompt.trim()
    : "";
  const escalate = isRecord(value)
    ? numberIn(value.escalate_below ?? 0.7, 0, 1)
    : null;
  const payloadTokens = isRecord(value)
    ? numberIn(value.payload_tokens ?? 3000, 500, 20000)
    : null;
  const sampleCards = isRecord(value)
    ? numberIn(value.sample_cards ?? 5, 0, 50)
    : null;
  if (
    cheap === undefined || cheap === null || strong === undefined ||
    strong === null || prompt === "" || prompt.length > 8000 ||
    escalate === null || payloadTokens === null || sampleCards === null ||
    !Number.isInteger(payloadTokens) || !Number.isInteger(sampleCards)
  ) return failure(400, "bad_request");
  const secrets = new Map<Provider, string>();
  for (const tier of [cheap, strong]) {
    const key = await keys.get(tier.provider);
    if (key === null) return failure(409, "no_key");
    secrets.set(tier.provider, key);
  }
  for (const tier of [cheap, strong]) {
    const answer = await ask({
      provider: tier.provider,
      model: tier.model,
      key: secrets.get(tier.provider) ?? "",
      instructions: instructions(prompt),
      user: CHECK_NOTE,
      fetch: deps.fetch,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const failed = checkFailure(answer);
    if (failed !== null) return failure(422, failed);
  }
  const saved = await call(service, deps, "save_triage_configuration", {
    admin_id: id,
    cheap_provider: cheap.provider,
    cheap_model: cheap.model,
    strong_provider: strong.provider,
    strong_model: strong.model,
    prompt,
    cheap_in_usd: cheap.inUsd,
    cheap_out_usd: cheap.outUsd,
    strong_in_usd: strong.inUsd,
    strong_out_usd: strong.outUsd,
    escalate_below: escalate,
    payload_tokens: payloadTokens,
    sample_cards: sampleCards,
  });
  return {
    status: 200,
    code: "saved",
    body: { saved: true, configuration_id: saved },
  };
}

function readTier(value: unknown): Tier | null {
  if (!isRecord(value)) return null;
  const provider = parseProvider(value.provider);
  const inUsd = numberIn(value.in_usd, 0, 1000);
  const outUsd = numberIn(value.out_usd, 0, 1000);
  return provider === null || typeof value.model !== "string" ||
      value.model.trim() === "" || inUsd === null || outUsd === null
    ? null
    : { provider, model: value.model.trim(), inUsd, outUsd };
}

/** Whether the token's owner is an admin and signed in recently, by `admin_ai_session`. */
async function adminSession(
  token: string,
  deps: SupabaseDeps,
): Promise<"recent" | "stale" | "not_admin"> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/admin_ai_session`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  ).catch((cause: unknown) => {
    throw new SupabaseError("admin_ai_session could not be reached", { cause });
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return "not_admin";
  }
  if (!response.ok) {
    throw new SupabaseError(`admin_ai_session answered ${response.status}`);
  }
  const recent: unknown = await response.json();
  if (typeof recent !== "boolean") {
    throw new SupabaseError("admin_ai_session answered no boolean");
  }
  return recent ? "recent" : "stale";
}

/** Calls a database function as the service role; its answer is the body, or a SupabaseError. */
async function call(
  keys: Keys,
  deps: Deps,
  name: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await deps.fetch(`${keys.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: keys.key,
      Authorization: `Bearer ${keys.bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new SupabaseError(`${name} could not be reached`, { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`${name} answered ${response.status}`);
  }
  return response.status === 204 ? null : await response.json();
}
