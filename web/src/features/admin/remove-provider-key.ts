"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseProvider } from "./read-admin";

/**
 * Removes [provider]'s key from Vault. The server checks the role and a sign-in within 10 minutes,
 * refuses a key an active configuration uses, and records it.
 */
export async function removeProviderKey(provider: string): Promise<ActionResult> {
  const known = parseProvider(provider);
  if (known === null) return refused("malformed");
  const result = await call("admin_remove_provider_key", { provider: known });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "removed":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "키를 삭제했어요." };
    case "in_use":
      return {
        changed: false,
        message: "사용 중인 키예요. 이 키를 쓰지 않는 설정을 먼저 적용해 주세요.",
      };
    case "reauth":
      return { changed: false, message: "보안을 위해 다시 로그인한 뒤 삭제해 주세요." };
    case "none":
      return { changed: false, message: "지울 키가 없어요." };
    default:
      return refused("unreadable");
  }
}
