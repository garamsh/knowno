import type { SupabaseClient } from "@supabase/supabase-js";

/** The Services ID the web signs in to Apple with, first among Supabase's Apple Client IDs. */
export const appleServicesId = "app.knowno.web";

/** Sign in with Apple JS from Apple's CDN, its button titled in Korean as the page is. */
export const appleScriptUrl =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ko_KR/appleid.auth.js";

/**
 * The return URL Apple's popup is opened for: this host's `/login`, registered on the Services ID
 * for knowno.app and admin.knowno.app alike.
 */
export function appleRedirectUri(origin: string): string {
  return `${origin}/login`;
}

/** A new raw nonce for one sign-in: 32 random bytes as hex. */
export function createNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The SHA-256 of [value] as hex, the form Apple is given the nonce in. */
export async function sha256Hex(value: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

/** A nonce pair for one sign-in: the raw nonce Supabase is given and its SHA-256 Apple is given. */
export async function drawNoncePair(): Promise<{ raw: string; hashed: string }> {
  const raw = createNonce();
  return { raw, hashed: await sha256Hex(raw) };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What Apple's popup returned on success: the identity token, and the name on a first sign-in. */
export type AppleCredential = {
  idToken: string;
  name: { given: string; family: string } | null;
};

/**
 * Parses the detail of Apple's `AppleIDSignInOnSuccess` event, `{ authorization: { id_token },
 * user?: { name: { firstName, lastName } } }`; null when it carries no identity token.
 */
export function parseAppleSuccess(detail: unknown): AppleCredential | null {
  if (!isRecord(detail) || !isRecord(detail.authorization)) return null;
  const idToken = detail.authorization.id_token;
  if (typeof idToken !== "string" || idToken === "") return null;
  const name = isRecord(detail.user) && isRecord(detail.user.name) ? detail.user.name : null;
  const given = typeof name?.firstName === "string" ? name.firstName.trim() : "";
  const family = typeof name?.lastName === "string" ? name.lastName.trim() : "";
  return { idToken, name: given || family ? { given, family } : null };
}

/**
 * Whether the detail of Apple's `AppleIDSignInOnFailure` event is the user stepping away rather
 * than a failure: the popup closed, Apple's Cancel, or a new sign-in started over this one.
 */
export function isAppleCancel(detail: unknown): boolean {
  if (!isRecord(detail)) return false;
  return (
    detail.error === "popup_closed_by_user" ||
    detail.error === "user_cancelled_authorize" ||
    detail.error === "user_trigger_new_signin_flow"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** How a sign-in with Apple's identity token ended, by the reasons `/login` names. */
export type AppleSignInOutcome = "signedIn" | "suspended" | "failed";

/**
 * Signs in to Supabase with Apple's identity token and the raw nonce whose SHA-256 Apple was
 * given, then stores the name Apple shares on a first sign-in, as the phone does (ADR 0186). A
 * name that cannot be stored is logged and the user stays signed in.
 */
export async function signInWithApple(
  auth: Pick<SupabaseClient["auth"], "signInWithIdToken" | "updateUser">,
  credential: AppleCredential,
  rawNonce: string,
): Promise<AppleSignInOutcome> {
  const { error } = await auth.signInWithIdToken({
    provider: "apple",
    token: credential.idToken,
    nonce: rawNonce,
  });
  if (error) return error.code === "user_banned" ? "suspended" : "failed";
  if (credential.name) {
    const { given, family } = credential.name;
    try {
      const { error: notStored } = await auth.updateUser({
        data: {
          full_name: [given, family].filter(Boolean).join(" "),
          given_name: given,
          family_name: family,
        },
      });
      if (notStored) console.error("Apple's name was not stored", notStored);
    } catch (thrown) {
      console.error("Apple's name was not stored", thrown);
    }
  }
  return "signedIn";
}
