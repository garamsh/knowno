"use server";

import { revalidatePath } from "next/cache";

import { failureMessages } from "./action-call";
import { type AiFormState, postSettings } from "./ai-settings";
import { checkModelId } from "./model-id";
import { parsePlanId, parseProvider } from "./read-admin";

/**
 * Saves the form's `provider`, `model` and `prompt_version_id` as its `plan`'s one draft, served
 * to admins only, after extract-cards' one call with the provider's key parsed (ADR 0162). Without
 * a prompt version the draft keeps the plan's draft's prompt, or else the active one's. It reaches
 * the plan's users only once an admin applies it to everyone.
 */
export async function saveAiConfiguration(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const plan = parsePlanId(form.get("plan"));
  const provider = parseProvider(form.get("provider"));
  const model = form.get("model");
  const prompt = form.get("prompt_version_id") ?? "";
  if (plan === null || provider === null || typeof prompt !== "string") {
    return { message: failureMessages.malformed, reauth: false };
  }
  if (prompt !== "" && !/^[1-9]\d{0,15}$/.test(prompt)) {
    return { message: failureMessages.malformed, reauth: false };
  }
  const checked = checkModelId(provider, model);
  if ("message" in checked) return { message: checked.message, reauth: false };
  const result = await postSettings("extract-cards/settings/configuration", {
    plan,
    provider,
    model: checked.id,
    ...(prompt === "" ? {} : { prompt_version_id: Number(prompt) }),
  });
  if (!result.saved) return result.state;
  revalidatePath("/admin", "layout");
  return { message: "확인하고 초안으로 저장했어요. 관리자만 이 구성을 써요.", reauth: false };
}
