/**
 * The publish-note HTTP handler (ADR 0238, ADR 0239). `POST /` is the owner asking to publish a note: it
 * records the request as the owner, screens the note at once and answers its state and findings.
 * `POST /work` is the sweeper's, with the service-role key: it screens every note that is due.
 * Nothing here logs or stores a note's text; the log holds ids, a route and an outcome.
 */

import { authenticate, SupabaseError } from "../_shared/auth.ts";
import type { Keys as ProviderKeys } from "../_shared/keys.ts";
import {
  buildPayload,
  type Decision,
  isDecided,
  judgeNote,
  openRouterJudge,
  parseState,
  unavailableDecision,
} from "../_shared/screening/ai.ts";
import {
  type Claim,
  RULES_VERSION,
  screen,
} from "../_shared/screening/rules.ts";
import type { Config } from "./config.ts";

export type Deps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  /** The providers' keys; the AI layer asks OpenRouter's. */
  readonly keys: ProviderKeys;
  readonly log: (entry: Record<string, unknown>) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most notes one `/work` call screens. */
const WORK_BATCH = 20;
const MAX_DESCRIPTION = 2000;

type Keys = {
  readonly url: string;
  readonly key: string;
  readonly bearer: string;
};

export function createHandler(
  deps: Deps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const route = new URL(request.url).pathname.replace(/\/+$/, "").split("/")
      .pop();
    const kind = route === "work" ? "work" : "publish";
    const reply = (status: number, outcome: string, body?: unknown) => {
      deps.log({ route: kind, outcome, status });
      return body === undefined
        ? new Response(null, { status })
        : Response.json(body, { status });
    };
    if (request.method !== "POST") {
      deps.log({ route: kind, outcome: "method_not_allowed" });
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const config = deps.config;
    if (config.kind === "not_configured") {
      return reply(503, "not_configured", { error: "not_configured" });
    }
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
        if (bearer === undefined || !sameText(bearer, config.serviceRoleKey)) {
          return reply(401, "unauthenticated", { error: "unauthenticated" });
        }
        const due = await call(service, deps, "screening_due", {
          max_decks: WORK_BATCH,
        });
        const ids = Array.isArray(due)
          ? due.flatMap((row: unknown) =>
            isRecord(row) && typeof row.deck_id === "string"
              ? [row.deck_id]
              : []
          )
          : [];
        const outcomes: Record<string, number> = {};
        for (const id of ids) {
          // Any failure of one note leaves the others their turn: the same note stays at the
          // head of the queue, and a throw out of the batch would stop every later sweep.
          const outcome = await screenDeck(id, service, deps).catch(
            () => {
              deps.log({ route: "work", deck: id, outcome: "failed" });
              return "failed";
            },
          );
          outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        }
        deps.log({
          route: "work",
          outcome: "worked",
          decks: ids.length,
          outcomes,
        });
        return Response.json({ screened: ids.length, outcomes });
      }
      const token = request.headers.get("Authorization");
      const user = await authenticate(token, {
        url: config.supabaseUrl,
        serviceRoleKey: config.serviceRoleKey,
        fetch: deps.fetch,
      });
      if (user === null || token === null) {
        return reply(401, "unauthenticated", { error: "unauthenticated" });
      }
      const body: unknown = await request.json().catch(() => null);
      const deckId = isRecord(body) ? body.deck_id : undefined;
      const description = isRecord(body) ? body.description : undefined;
      if (
        typeof deckId !== "string" || !UUID.test(deckId) ||
        (description !== undefined && description !== null &&
          (typeof description !== "string" ||
            description.length > MAX_DESCRIPTION))
      ) return reply(400, "bad_request", { error: "bad_request" });
      const owner: Keys = {
        url: config.supabaseUrl,
        key: config.anonKey,
        bearer: token.replace(/^Bearer /, ""),
      };
      const asked = await callAs(owner, deps, "request_deck_publication", {
        deck_id: deckId,
        description: description ?? null,
      });
      if (asked.status === 401 || asked.status === 403) {
        return reply(403, "forbidden", { error: "forbidden" });
      }
      if (asked.status >= 400 && asked.status < 500) {
        return reply(404, "not_found", { error: "not_found" });
      }
      if (!asked.ok) {
        throw new SupabaseError("request answered " + asked.status);
      }
      const outcome = await screenDeck(deckId, service, deps);
      const mine = await callAs(owner, deps, "my_deck_screening", {
        deck_id: deckId,
      });
      if (!mine.ok || !isRecord(mine.body)) {
        throw new SupabaseError("my_deck_screening answered no state");
      }
      deps.log({
        route: "publish",
        deck: deckId,
        outcome,
        state: mine.body.state,
      });
      return Response.json(mine.body);
    } catch (error) {
      if (!(error instanceof SupabaseError)) throw error;
      deps.log({ route: kind, outcome: "supabase_error" });
      return Response.json({ error: "unavailable" }, { status: 502 });
    }
  };
}

/**
 * Screens one note: claims it with its hash, runs the rules unless a verdict of this version
 * stands, records it, asks the AI layer unless the rules refused the note or a verdict of it
 * stands, and lets the database decide. Answers `apply_screening`'s word, or `skipped` for a note
 * that is no longer checking or public.
 */
export async function screenDeck(
  deckId: string,
  service: Keys,
  deps: Deps,
): Promise<string> {
  const claim = await call(service, deps, "screening_claim", {
    deck_id: deckId,
  });
  if (!isRecord(claim) || typeof claim.hash !== "string") return "skipped";
  const version = `${RULES_VERSION}+${String(claim.terms_version)}`;
  const verdicts = Array.isArray(claim.verdicts) ? claim.verdicts : [];
  const stored = verdicts.some((v: unknown) =>
    isRecord(v) && v.layer === "rules" && v.version === version
  );
  const verdict = screen(claim as unknown as Claim);
  if (!stored) {
    const recorded = await call(service, deps, "record_screening", {
      deck_id: deckId,
      content_hash: claim.hash,
      layer: "rules",
      version,
      outcome: verdict.outcome,
      findings: verdict.findings,
    });
    if (recorded === "changed") return "changed";
  }
  const asked = verdicts.some((v: unknown) =>
    isRecord(v) && v.layer === "ai" && isDecided(v.version)
  );
  if ((verdict.outcome === "clean" || verdict.outcome === "unsure") && !asked) {
    const decision = await askAi(
      deckId,
      claim,
      verdict.findings,
      service,
      deps,
    );
    deps.log({
      route: "ai",
      deck: deckId,
      outcome: decision.outcome,
      version: decision.version,
      unavailable: decision.unavailable,
      failure: decision.failure,
      findings: decision.findings.map((f) => f.category),
    });
    const recorded = await call(service, deps, "record_screening", {
      deck_id: deckId,
      content_hash: claim.hash,
      layer: "ai",
      version: decision.version,
      outcome: decision.outcome,
      findings: decision.findings,
    });
    if (recorded === "changed") return "changed";
  }
  const applied = await call(service, deps, "apply_screening", {
    deck_id: deckId,
    content_hash: claim.hash,
  });
  return typeof applied === "string" ? applied : "unknown";
}

/** The photos' largest size sent to a model. */
const MAX_PHOTO_BYTES = 5_000_000;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The AI layer's verdict on a claimed note; one the layer could not decide holds the note. */
async function askAi(
  deckId: string,
  claim: Record<string, unknown>,
  findings: readonly { readonly card: string | null }[],
  service: Keys,
  deps: Deps,
): Promise<Decision> {
  const state = parseState(await call(service, deps, "screening_ai_state", {}));
  if (state === null) return unavailableDecision("no_settings");
  const apiKey = await deps.keys.get("openrouter");
  if (apiKey === null) return unavailableDecision("no_key");
  const payload = buildPayload(
    claim as unknown as Claim,
    new Set(findings.flatMap((f) => f.card === null ? [] : [f.card])),
    String(claim.hash),
    state.settings,
  );
  const images = new Map<number, string>();
  for (const item of payload.items) {
    if (item.kind !== "photo") continue;
    const url = await photoUrl(service, deps, String(claim.owner), item.media);
    if (url === null) return unavailableDecision("failed");
    images.set(item.n, url);
  }
  return await judgeNote({
    state,
    payload,
    images,
    judge: openRouterJudge({ fetch: deps.fetch, apiKey }),
    spend: async (spent) => {
      await call(service, deps, "record_screening_call", {
        deck_id: deckId,
        settings_id: state.settings.id,
        tier: spent.tier,
        model: spent.model,
        prompt_tokens: spent.usage?.promptTokens ?? null,
        completion_tokens: spent.usage?.completionTokens ?? null,
        cost_usd: spent.costUsd,
      });
    },
  });
}

/** A card's photo as a data URL read from the `media` bucket, or null when it cannot be. */
async function photoUrl(
  service: Keys,
  deps: Deps,
  owner: string,
  media: string | null,
): Promise<string | null> {
  if (media === null || !UUID.test(owner) || !UUID.test(media)) return null;
  const response = await deps.fetch(
    `${service.url}/storage/v1/object/media/${owner}/${media}`,
    {
      headers: {
        apikey: service.key,
        Authorization: `Bearer ${service.bearer}`,
      },
    },
  ).catch(() => null);
  if (response === null || !response.ok) {
    await response?.body?.cancel();
    return null;
  }
  const type = response.headers.get("Content-Type")?.split(";")[0] ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!PHOTO_TYPES.includes(type) || bytes.length > MAX_PHOTO_BYTES) {
    return null;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Calls a database function; its answer is the body, or a SupabaseError for any refusal. */
async function call(
  keys: Keys,
  deps: Deps,
  name: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const answer = await callAs(keys, deps, name, body);
  if (!answer.ok) throw new SupabaseError(`${name} answered ${answer.status}`);
  return answer.body;
}

async function callAs(
  keys: Keys,
  deps: Deps,
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
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
    return { ok: false, status: response.status, body: null };
  }
  return {
    ok: true,
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

/** Whether [a] and [b] are the same text, compared in a time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let differ = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    differ |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return differ === 0;
}
