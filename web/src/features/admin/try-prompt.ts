"use server";

import { env } from "@/env";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";

import { call, failureMessages } from "./action-call";

/** A card the trial extracted, as the page shows it. */
export type TrialCard = { front: string; back: string };

/** What a trial on one photo shows: the cards, or why there are none. */
export type TrialResult = { cards: TrialCard[] } | { message: string };

/** The photo types extract-cards accepts. */
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/** How long the trial waits for extract-cards, whose one model call can take most of a minute. */
const trialTimeoutMs = 90_000;

/**
 * Runs extract-cards on the form's `photo` as the signed-in admin, who is served the test version
 * when one is set and the active one otherwise (ADR 0073). No photo limit applies to an admin (ADR
 * 0157); the photo is recorded with its version, as any extraction is. A user who is not an admin
 * is refused before the function is called.
 */
export async function tryPrompt(form: FormData): Promise<TrialResult> {
  const photo = form.get("photo");
  if (!(photo instanceof File) || !photoTypes.has(photo.type) || photo.size === 0) {
    return { message: "JPEG, PNG 또는 WebP 사진을 골라 주세요." };
  }
  const admin = await call("is_admin", {});
  if ("failure" in admin) return { message: failureMessages[admin.failure] };
  if (admin.data !== true) return { message: failureMessages.rejected };
  const supabase = await createClient();
  // extract-cards verifies the token with Supabase Auth itself.
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (token === undefined) return { message: failureMessages.rejected };
  const image = Buffer.from(await photo.arrayBuffer()).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/functions/v1/extract-cards`, {
      method: "POST",
      headers: {
        apikey: env.supabasePublishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(trialTimeoutMs),
    });
  } catch {
    return { message: failureMessages.unreachable };
  }
  const body: unknown = await response.json().catch(() => null);
  return trialResult(response.status, body);
}

/** The trial's result for extract-cards' answer [status] with [body], read at the boundary. */
function trialResult(status: number, body: unknown): TrialResult {
  switch (status) {
    case 200: {
      const list = field(body, "cards");
      const cards = Array.isArray(list) ? list.map(trialCard) : null;
      if (cards === null || cards.length === 0 || cards.includes(null)) {
        return { message: failureMessages.unreadable };
      }
      return { cards: cards.filter((card) => card !== null) };
    }
    case 422:
      return { message: "이 사진에서 카드를 찾지 못했어요." };
    case 413:
    case 415:
      return { message: "이 사진은 쓸 수 없어요. 다른 사진을 골라 주세요." };
    case 502:
      return { message: "모델이 카드를 만들지 못했어요. 다시 시도해 주세요." };
    default:
      return { message: failureMessages.failed };
  }
}

function trialCard(value: unknown): TrialCard | null {
  const front = field(value, "front");
  const back = field(value, "back");
  return typeof front === "string" && typeof back === "string" ? { front, back } : null;
}
