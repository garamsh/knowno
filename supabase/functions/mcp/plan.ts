/**
 * Whether the caller may use the connection: every plan but 무료 may (ADR 0241). The plan is read
 * through `public.my_plan` with the caller's own token, the read behind 내 플랜, so an admin and a
 * 무제한 user, whom it shows as 프로, pass with the rest.
 */

import { SupabaseError } from "../_shared/auth.ts";
import type { Store } from "../_shared/store.ts";

/** The sentence a 무료 user is refused with, at the connection and at every tool call. */
export const FREE_REFUSAL =
  "AI 연결은 플러스부터 쓸 수 있어요. 지금은 무료 플랜이라 연결할 수 없습니다. knowno 앱의 내 플랜에서 플러스를 시작하면 바로 쓸 수 있어요.";

/**
 * Whether the caller is on 무료. Throws [SupabaseError] when the database cannot be reached or does
 * not answer one plan, so a failed read never lets a 무료 user through.
 */
export async function onFree(store: Store): Promise<boolean> {
  const response = await store.fetch(`${store.url}/rest/v1/rpc/my_plan`, {
    method: "POST",
    headers: {
      apikey: store.anonKey,
      Authorization: `Bearer ${store.token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).catch((cause: unknown) => {
    throw new SupabaseError("my_plan could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`my_plan answered ${response.status}`);
  }
  const rows: unknown = await response.json();
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (
    typeof row !== "object" || row === null || !("plan" in row) ||
    (row.plan !== "free" && row.plan !== "pro" && row.plan !== "max")
  ) {
    throw new SupabaseError("my_plan answered no plan");
  }
  return row.plan === "free";
}
