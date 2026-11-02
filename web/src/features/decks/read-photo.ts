"use server";

import { env } from "@/env";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { field } from "@/supabase/row";
import { parseCandidates, type Candidate } from "./photo-candidates";
import type { PhotoFailure } from "./photo-failure";

/**
 * A per-request result, without exposing service errors or credentials; `cursor` when the function
 * left the page unread past the cards, to send back with the same photo to read on (ADR 0138).
 */
export type Extraction = { cards: Candidate[]; cursor: string | null } | { failure: PhotoFailure };

/** The upload bound: the browser prepares every photo under it, inside the 6 MiB action limit. */
const maxUploadBytes = 3 * 1024 * 1024;

/** The longest cursor the function takes, as its `MAX_CURSOR_LENGTH`. */
const maxCursorLength = 24 * 1024;

/**
 * How long a request waits for the function: past its worst case, a retry started by 75 s that
 * times out at 60 s, about 135 s (ADR 0130), and under the Edge Function's 150 s wall clock.
 */
const extractionTimeoutMs = 145_000;

/**
 * Calls the existing extraction function as the verified user, without a browser CORS request,
 * reading the page on from the form's `cursor` when it holds one, and logs one line per request
 * with the function's status and latency, never the image, cursor or token.
 */
export async function readPhoto(form: FormData): Promise<Extraction> {
  if (!(form instanceof FormData)) return { failure: { kind: "refused" } };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > maxUploadBytes)
    return { failure: { kind: "refused" } };
  const cursor = form.get("cursor");
  if (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > maxCursorLength))
    return { failure: { kind: "refused" } };
  const client = await createClient();
  const user = await readUserId(client);
  if ("failure" in user)
    return { failure: { kind: user.failure === "unreachable" ? "service" : "signIn" } };
  const session = await client.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) return { failure: { kind: "signIn" } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!jpeg && !png && !webp) return { failure: { kind: "refused" } };
  const body = JSON.stringify({
    image: Buffer.from(bytes).toString("base64"),
    ...(cursor === null ? {} : { cursor }),
  });
  const started = Date.now();
  let attempts = 0;
  let status: number | "timeout" | "unreachable" = "unreachable";
  let result: Extraction = { failure: { kind: "service" } };
  // A request that got no response may never have reached the function, so it is sent once more;
  // a timeout or any answer is not, since the function counts a photo before calling the model.
  while (attempts < 2 && status === "unreachable") {
    attempts += 1;
    try {
      const response = await fetch(
        `${env.supabaseUrl.replace(/\/$/u, "")}/functions/v1/extract-cards`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: env.supabasePublishableKey,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(extractionTimeoutMs),
        },
      );
      status = response.status;
      result = parseExtraction(
        response.status,
        await response.json().catch(() => null),
        cursor !== null,
      );
    } catch (cause) {
      status =
        cause instanceof DOMException && cause.name === "TimeoutError" ? "timeout" : "unreachable";
    }
  }
  console.info(
    JSON.stringify({
      event: "read_photo",
      status,
      ms: Date.now() - started,
      attempts,
      resumed: cursor !== null,
      bytes: bytes.length,
      outcome: "cards" in result ? "cards" : result.failure.kind,
      cards: "cards" in result ? result.cards.length : 0,
    }),
  );
  return result;
}

/**
 * The cards a 200 holds with its cursor, or the failure a status means, as the phone's
 * `parseExtraction`; a [resumed] request may answer no card, the page ending where it left off.
 * A 410, a cursor the function no longer takes, is `service`.
 */
function parseExtraction(status: number, body: unknown, resumed: boolean): Extraction {
  if (status === 200) {
    const cards = parseCandidates(body, resumed);
    const cursor = field(body, "cursor");
    return cards
      ? {
          cards,
          cursor:
            field(body, "partial") === true && typeof cursor === "string" && cursor ? cursor : null,
        }
      : { failure: { kind: "service" } };
  }
  if (status === 401) return { failure: { kind: "signIn" } };
  if (status === 403 && field(body, "error") === "suspended")
    return { failure: { kind: "suspended" } };
  if (status === 413 || status === 415) return { failure: { kind: "refused" } };
  if (status === 422) return { failure: { kind: "noCards" } };
  if (status === 429) {
    const limit = field(body, "photo_limit");
    const period = field(body, "period");
    if (
      typeof limit === "number" &&
      Number.isInteger(limit) &&
      limit >= 0 &&
      (period === "day" || period === "month")
    )
      return { failure: { kind: "limit", limit, period } };
  }
  if (status === 502) return { failure: { kind: "model" } };
  return { failure: { kind: "service" } };
}
