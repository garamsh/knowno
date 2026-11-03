"use server";

import { revalidatePath } from "next/cache";

import { failureMessages } from "./action-call";
import { type AiFormState, postSettings } from "./ai-settings";
import { parsePlanId, parseProvider } from "./read-admin";

/**
 * Saves the form's `provider` and `model` as its `plan`'s draft, served to admins only, after
 * extract-cards' one call with the provider's key parsed (ADR 0162). It reaches the plan's users
 * only once an admin applies it to everyone.
 */
export async function saveAiConfiguration(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const plan = parsePlanId(form.get("plan"));
  const provider = parseProvider(form.get("provider"));
  const model = form.get("model");
  if (plan === null || provider === null) {
    return { message: failureMessages.malformed, reauth: false };
  }
  const id = typeof model === "string" ? model.trim() : "";
  const shape = provider === "openrouter" ? /^[\w.-]+\/[\w.:-]+$/ : /^[\w.:-]+$/;
  if (!shape.test(id) || id.length > 200) {
    return {
      message:
        provider === "openrouter"
          ? "모델 ID는 vendor/model 꼴로 적어 주세요."
          : "모델 ID를 빈칸이나 / 없이 적어 주세요.",
      reauth: false,
    };
  }
  const result = await postSettings("configuration", { plan, provider, model: id });
  if (!result.saved) return result.state;
  revalidatePath("/admin", "layout");
  return { message: "확인하고 테스트로 저장했어요. 관리자만 이 설정을 써요.", reauth: false };
}
