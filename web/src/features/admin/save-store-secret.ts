"use server";

import { revalidatePath } from "next/cache";

import { call, failureMessages } from "./action-call";
import type { AiFormState } from "./ai-settings";
import { parseStoreSecretName } from "./read-admin";

/**
 * Saves the form's `value` as the RevenueCat secret `name`, replacing any it had (ADR 0241). The
 * admin must have signed in within 10 minutes; the server checks the value's shape and stores it
 * in Vault. The value is never returned.
 */
export async function saveStoreSecret(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const name = parseStoreSecretName(form.get("name"));
  const value = form.get("value");
  if (name === null) return { message: failureMessages.malformed, reauth: false };
  if (typeof value !== "string" || value === "") {
    return { message: "값을 적어 주세요.", reauth: false };
  }
  const result = await call("admin_set_store_secret", { name, value });
  if ("failure" in result) return { message: failureMessages[result.failure], reauth: false };
  switch (result.data) {
    case "saved":
      revalidatePath("/admin", "layout");
      return { message: "저장했어요.", reauth: false };
    case "reauth":
      return { message: "보안을 위해 다시 로그인한 뒤 저장해 주세요.", reauth: true };
    case "bad_secret":
      return {
        message:
          name === "knowno_store_api_key"
            ? "키는 빈칸 없이 8자에서 1,000자 사이여야 해요."
            : "값은 영문, 숫자, 기호로 16자에서 1,000자 사이여야 해요.",
        reauth: false,
      };
    default:
      return { message: failureMessages.unreadable, reauth: false };
  }
}
