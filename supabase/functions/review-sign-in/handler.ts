/**
 * The review-sign-in request pipeline (ADR 0226): one address, set in Vault by the owner, signs in
 * with one code, also in Vault, and gets the token hash of a Supabase email sign-in, which the app
 * exchanges for a session as it would a link's. Every other attempt is refused alike.
 */

import { type SupabaseDeps, SupabaseError } from "../_shared/auth.ts";
import type { Config } from "./config.ts";
import { begin } from "./vault.ts";

/** How a request ended; a refusal's body carries the same code. */
export type Outcome =
  | "signed_in"
  | "method_not_allowed"
  | "bad_request"
  | "not_configured"
  | "refused"
  | "rate_limited"
  | "unavailable"
  | "internal";

/** The one line logged per request. It carries the outcome alone: never an address or a code. */
export type LogEntry = { readonly outcome: Outcome };

export type HandlerDeps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly log: (entry: LogEntry) => void;
};

/** The shortest code taken: a shorter one is treated as no code, since the attempt limit alone guards it. */
export const MIN_CODE = 12;

/** The longest address and code a request may carry; longer is a bad request. */
const MAX_EMAIL = 254;
const MAX_CODE = 128;

/** How long, in seconds, a limited caller is told to wait: the window of the limit. */
const RETRY_AFTER = "600";

export function status(outcome: Outcome): number {
  switch (outcome) {
    case "signed_in":
      return 200;
    case "bad_request":
      return 400;
    case "refused":
      return 401;
    case "method_not_allowed":
      return 405;
    case "rate_limited":
      return 429;
    case "internal":
      return 500;
    case "unavailable":
      return 502;
    case "not_configured":
      return 503;
  }
}

type Attempt = { readonly email: string; readonly code: string };

/** The request's address, trimmed and lower-cased, and its code, trimmed, or null for any other body. */
async function parse(request: Request): Promise<Attempt | null> {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" || body === null || !("email" in body) ||
    !("code" in body) || typeof body.email !== "string" ||
    typeof body.code !== "string"
  ) {
    return null;
  }
  const email = normalize(body.email);
  const code = body.code.trim();
  return email.length > 0 && email.length <= MAX_EMAIL && code.length > 0 &&
      code.length <= MAX_CODE
    ? { email, code }
    : null;
}

/** An address as compared: trimmed and lower-cased. */
export const normalize = (email: string): string => email.trim().toLowerCase();

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Whether [a] and [b] are the same text, in time that depends on neither's content: both are
 * hashed to 32 bytes, and every byte is compared whatever the first difference.
 */
export async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let outcome: Outcome;
    let tokenHash: string | null = null;
    try {
      ({ outcome, tokenHash } = await handle(request, deps));
    } catch (error) {
      deps.log({ outcome: "internal" });
      throw error;
    }
    deps.log({ outcome });
    if (outcome === "signed_in") {
      return Response.json({ token_hash: tokenHash, type: "email" });
    }
    return Response.json({ error: outcome }, {
      status: status(outcome),
      headers: outcome === "rate_limited" ? { "Retry-After": RETRY_AFTER } : {},
    });
  };
}

type Result = { readonly outcome: Outcome; readonly tokenHash: string | null };

const ended = (outcome: Outcome): Result => ({ outcome, tokenHash: null });

async function handle(request: Request, deps: HandlerDeps): Promise<Result> {
  if (request.method !== "POST") return ended("method_not_allowed");
  const config = deps.config;
  if (config.kind === "not_configured") return ended("not_configured");
  const attempt = await parse(request);
  if (attempt === null) return ended("bad_request");
  const supabase: SupabaseDeps = {
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch: deps.fetch,
  };
  try {
    const start = await begin(hex(await digest(attempt.email)), supabase);
    if (start.kind === "limited") return ended("rate_limited");
    // Every attempt does the same two comparisons, so neither time nor answer tells a wrong
    // address from a wrong code, or either from no secret set.
    const emailMatches = await same(
      attempt.email,
      normalize(start.email ?? ""),
    );
    const codeMatches = await same(attempt.code, start.code ?? "");
    const configured = start.email !== null && normalize(start.email) !== "" &&
      start.code !== null && start.code.length >= MIN_CODE;
    if (!(emailMatches && codeMatches && configured)) return ended("refused");
    const tokenHash = await generateLink(attempt.email, supabase);
    return { outcome: "signed_in", tokenHash };
  } catch (error) {
    if (error instanceof SupabaseError) return ended("unavailable");
    throw error;
  }
}

/**
 * The hashed token of a magic link for [email], which Supabase Auth's admin API makes, creating the
 * user when the address has none, and sends to no one. Throws [SupabaseError] when it cannot.
 */
async function generateLink(
  email: string,
  deps: SupabaseDeps,
): Promise<string> {
  const response = await deps.fetch(`${deps.url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  }).catch((cause: unknown) => {
    throw new SupabaseError("auth admin could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`auth admin answered ${response.status}`);
  }
  const link: unknown = await response.json();
  if (
    typeof link !== "object" || link === null || !("hashed_token" in link) ||
    typeof link.hashed_token !== "string" || link.hashed_token === ""
  ) {
    throw new SupabaseError("auth admin answered no hashed token");
  }
  return link.hashed_token;
}
