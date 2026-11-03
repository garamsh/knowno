import "server-only";

import { env } from "@/env";
import { field } from "@/supabase/row";

import { failureMessages } from "./action-call";
import { adminToken } from "./trial";

/** What an AI settings form shows after an attempt; `reauth` asks the admin to sign in again. */
export type AiFormState = { message: string | null; reauth: boolean };

/** How long a save waits for extract-cards, which first makes one call to the provider. */
const settingsTimeoutMs = 90_000;

/** The sentence each refusal of extract-cards' settings routes shows (ADR 0162). */
const settingsMessages: Record<string, string> = {
  key_refused: "제공자가 이 키를 받지 않았어요. 키를 확인해 주세요.",
  model_not_found: "이 제공자에 없는 모델이에요. 모델 ID를 확인해 주세요.",
  no_image_input: "이 모델은 사진을 받지 않아요. 사진을 읽는 모델을 골라 주세요.",
  bad_output: "이 모델의 답이 카드 형식에 맞지 않았어요. 다른 모델을 골라 주세요.",
  call_failed: "제공자에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  no_key: "이 제공자의 키가 없어요. 먼저 키를 저장해 주세요.",
  reauth: "보안을 위해 다시 로그인한 뒤 저장해 주세요.",
  forbidden: failureMessages.rejected,
  unauthenticated: failureMessages.rejected,
  bad_request: failureMessages.malformed,
};

/**
 * Posts [body] to extract-cards' settings route [route] as the signed-in admin, which saves only
 * after one call with it parsed: whether it was saved, and otherwise the form's state saying why.
 * The body may hold a key: nothing of it is logged or returned.
 */
export async function postSettings(
  route: "key" | "configuration",
  body: Record<string, unknown>,
): Promise<{ saved: true } | { saved: false; state: AiFormState }> {
  const refusal = (message: string, reauth = false) => ({
    saved: false as const,
    state: { message, reauth },
  });
  const admin = await adminToken();
  if ("message" in admin) return refusal(admin.message);
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/functions/v1/extract-cards/settings/${route}`, {
      method: "POST",
      headers: {
        apikey: env.supabasePublishableKey,
        Authorization: `Bearer ${admin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settingsTimeoutMs),
    });
  } catch {
    return refusal(failureMessages.unreachable);
  }
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok && field(answer, "saved") === true) return { saved: true };
  const code = field(answer, "error");
  return refusal(
    (typeof code === "string" ? settingsMessages[code] : undefined) ?? failureMessages.failed,
    code === "reauth",
  );
}
