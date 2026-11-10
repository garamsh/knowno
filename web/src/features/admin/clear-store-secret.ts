"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseStoreSecretName } from "./read-admin";

/**
 * Removes the RevenueCat secret `name` from Vault. The server checks the role and a sign-in within
 * 10 minutes, and records it.
 */
export async function clearStoreSecret(name: string): Promise<ActionResult> {
  const known = parseStoreSecretName(name);
  if (known === null) return refused("malformed");
  const result = await call("admin_clear_store_secret", { name: known });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "cleared":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "삭제했어요." };
    case "reauth":
      return { changed: false, message: "보안을 위해 다시 로그인한 뒤 삭제해 주세요." };
    case "none":
      return { changed: false, message: "지울 값이 없어요." };
    default:
      return refused("unreadable");
  }
}
