"use server";

import { revalidatePath } from "next/cache";

import { failureMessages } from "./action-call";
import { type AiFormState, postSettings } from "./ai-settings";
import { checkModelId } from "./model-id";
import { parsePlanId, parseProvider, parseReasoningEffort } from "./read-admin";

/**
 * Saves the form's assistant configuration as its `plan`'s one draft, served to admins only, after
 * the assistant's one call with the provider's key parsed (ADR 0190): its `provider`, `model` and
 * `prompt_version_id`, whether `web_search` is checked, its `max_searches` a message, 1 to 10, and
 * its `reasoning_effort`. It reaches the plan's users only once an admin applies it to everyone.
 */
export async function saveAssistantConfiguration(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const plan = parsePlanId(form.get("plan"));
  const provider = parseProvider(form.get("provider"));
  const prompt = form.get("prompt_version_id");
  const searches = form.get("max_searches");
  const effort = parseReasoningEffort(form.get("reasoning_effort"));
  if (plan === null || provider === null || effort === null) {
    return { message: failureMessages.malformed, reauth: false };
  }
  if (typeof prompt !== "string" || !/^[1-9]\d{0,15}$/.test(prompt)) {
    return { message: failureMessages.malformed, reauth: false };
  }
  if (typeof searches !== "string" || !/^([1-9]|10)$/.test(searches)) {
    return { message: "검색 횟수는 1에서 10 사이로 적어 주세요.", reauth: false };
  }
  const checked = checkModelId(provider, form.get("model"));
  if ("message" in checked) return { message: checked.message, reauth: false };
  const result = await postSettings("assistant/settings/configuration", {
    plan,
    provider,
    model: checked.id,
    prompt_version_id: Number(prompt),
    web_search: form.get("web_search") === "on",
    max_searches: Number(searches),
    reasoning_effort: effort,
  });
  if (!result.saved) return result.state;
  revalidatePath("/admin", "layout");
  return { message: "확인하고 초안으로 저장했어요. 관리자만 이 구성을 써요.", reauth: false };
}
