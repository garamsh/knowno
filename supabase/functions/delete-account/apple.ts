/**
 * Revoking a user's Sign in with Apple authorization when the account is deleted (ADR 0210): the
 * authorization code the app got from a fresh Apple sheet is exchanged for a refresh token at
 * Apple's `/auth/token`, which `/auth/revoke` then revokes. Nothing here stops a deletion.
 */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import type { AppleConfig } from "./config.ts";

const APPLE = "https://appleid.apple.com";

/** How long a request to Apple may take before the deletion goes on without its revocation. */
const APPLE_TIMEOUT_MS = 10_000;

/** How long a client secret lives; Apple accepts up to six months, and one is made per request. */
const SECRET_SECONDS = 300;

/** What came of revoking: `revoked`, `none` for an account with no Apple identity, or why not. */
export type AppleOutcome =
  | "revoked"
  | "none"
  | "no_code"
  | "not_configured"
  | "mismatch"
  | "refused"
  | "unreachable";

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");

const json = (value: unknown): string =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The bytes of base64 [text], of either alphabet. */
const unbase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );

/** The `.p8` key's PKCS#8 bytes: its PEM body, which may arrive with its newlines written `\n`. */
function keyBytes(pem: string): Uint8Array<ArrayBuffer> {
  return unbase64(
    pem.replaceAll("\\n", "\n").replace(/-----[A-Z ]+-----/g, "")
      .replace(/\s+/g, ""),
  );
}

/**
 * Apple's client secret for [config]: an ES256 JWT of the team, the client and the audience
 * `https://appleid.apple.com`, signed with the Sign in with Apple key. Throws a DOMException when
 * the key is not a P-256 PKCS#8 key.
 */
async function clientSecret(
  config: AppleConfig,
  nowMs: number,
): Promise<string> {
  const issued = Math.floor(nowMs / 1000);
  const signing = `${json({ alg: "ES256", kid: config.keyId })}.${
    json({
      iss: config.teamId,
      iat: issued,
      exp: issued + SECRET_SECONDS,
      aud: APPLE,
      sub: config.clientId,
    })
  }`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes(config.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signing),
    ),
  );
  return `${signing}.${base64url(signature)}`;
}

/** The `sub` of the user's Apple identity in Supabase Auth, or null when it has none. */
async function appleSubject(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<string | null> {
  const response = await deps.fetch(
    `${deps.url}/auth/v1/admin/users/${userId}`,
    {
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
      },
    },
  ).catch((cause: unknown) => {
    throw new SupabaseError("auth admin could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`auth admin answered ${response.status}`);
  }
  const user: unknown = await response.json();
  const identities = typeof user === "object" && user !== null &&
      "identities" in user && Array.isArray(user.identities)
    ? user.identities
    : [];
  for (const identity of identities) {
    if (
      typeof identity !== "object" || identity === null ||
      !("provider" in identity) || identity.provider !== "apple"
    ) continue;
    const data = "identity_data" in identity ? identity.identity_data : null;
    const sub = typeof data === "object" && data !== null && "sub" in data
      ? data.sub
      : "provider_id" in identity
      ? identity.provider_id
      : null;
    if (typeof sub === "string" && sub !== "") return sub;
  }
  return null;
}

/** A form POST to Apple, or null when Apple could not be reached in time. */
async function post(
  path: string,
  form: Record<string, string>,
  fetcher: typeof fetch,
): Promise<Response | null> {
  try {
    return await fetcher(`${APPLE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof TypeError || error instanceof DOMException) {
      return null;
    }
    throw error;
  }
}

/** The `sub` claim of an identity token Apple's token endpoint returned, or null. */
function subjectOf(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(unbase64(idToken.split(".")[1] ?? "")),
    );
    return typeof claims === "object" && claims !== null && "sub" in claims &&
        typeof claims.sub === "string"
      ? claims.sub
      : null;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DOMException) {
      return null;
    }
    throw error;
  }
}

/**
 * Revokes the Apple authorization of the user [userId] with the authorization [code] the app
 * obtained at deletion, when the user has an Apple identity and the code and [apple] are given and
 * the code is of that identity. Throws [SupabaseError] only when Supabase Auth cannot be read.
 */
export async function revokeApple(
  userId: UserId,
  code: string | null,
  apple: AppleConfig | null,
  deps: SupabaseDeps,
  nowMs: number,
): Promise<AppleOutcome> {
  const subject = await appleSubject(userId, deps);
  if (subject === null) return "none";
  if (code === null) return "no_code";
  if (apple === null) return "not_configured";
  let secret: string;
  try {
    secret = await clientSecret(apple, nowMs);
  } catch (error) {
    if (error instanceof DOMException) return "not_configured";
    throw error;
  }
  const client = { client_id: apple.clientId, client_secret: secret };
  const exchanged = await post(
    "/auth/token",
    { ...client, code, grant_type: "authorization_code" },
    deps.fetch,
  );
  if (exchanged === null) return "unreachable";
  if (!exchanged.ok) {
    await exchanged.body?.cancel();
    return "refused";
  }
  const tokens: unknown = await exchanged.json().catch(() => null);
  const refresh = typeof tokens === "object" && tokens !== null &&
      "refresh_token" in tokens && typeof tokens.refresh_token === "string"
    ? tokens.refresh_token
    : null;
  const received = typeof tokens === "object" && tokens !== null &&
      "id_token" in tokens
    ? subjectOf(tokens.id_token)
    : null;
  if (refresh === null || received === null) return "refused";
  if (received !== subject) return "mismatch";
  const revoked = await post(
    "/auth/revoke",
    { ...client, token: refresh, token_type_hint: "refresh_token" },
    deps.fetch,
  );
  if (revoked === null) return "unreachable";
  await revoked.body?.cancel();
  return revoked.ok ? "revoked" : "refused";
}
