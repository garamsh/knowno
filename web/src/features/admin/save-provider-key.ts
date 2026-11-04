"use server";

import { revalidatePath } from "next/cache";

import { failureMessages } from "./action-call";
import { type AiFormState, postSettings } from "./ai-settings";
import { parseProvider } from "./read-admin";

/**
 * Saves the form's `key` as its `provider`'s, replacing any it had, after extract-cards' one call
 * with it and the form's `model` parsed (ADR 0162). The admin must have signed in within 10
 * minutes; a key that fails is not stored, so a key in use is never replaced by one that fails.
 * The key goes only to extract-cards, which stores it in Vault.
 */
export async function saveProviderKey(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const provider = parseProvider(form.get("provider"));
  const key = form.get("key");
  const model = form.get("model");
  if (provider === null) return { message: failureMessages.malformed, reauth: false };
  if (typeof key !== "string" || !/^\S{8,1000}$/.test(key.trim())) {
    return { message: "키를 빈칸 없이 붙여 넣어 주세요.", reauth: false };
  }
  if (typeof model !== "string" || model.trim() === "") {
    return { message: "확인할 모델 ID를 적어 주세요.", reauth: false };
  }
  const result = await postSettings("extract-cards/settings/key", {
    provider,
    key: key.trim(),
    model: model.trim(),
  });
  if (!result.saved) return result.state;
  revalidatePath("/admin", "layout");
  return { message: "키를 확인하고 저장했어요.", reauth: false };
}
