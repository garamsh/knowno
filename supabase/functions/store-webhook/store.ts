/**
 * The two RevenueCat secrets in Vault and the store grant, through `public.store_secrets` and
 * `public.apply_store_entitlement` (ADR 0241).
 */

import { type SupabaseDeps, SupabaseError } from "../_shared/auth.ts";

/** What Vault holds, each null while the owner has set none. */
export type Secrets = {
  readonly webhookAuthorization: string | null;
  readonly apiKey: string | null;
};

/** What `apply_store_entitlement` answers for a plan it accepted. */
export type Applied =
  | "granted"
  | "changed"
  | "ended"
  | "unchanged"
  | "no_user";

async function rpc(
  name: string,
  body: Record<string, unknown>,
  deps: SupabaseDeps,
): Promise<unknown> {
  const response = await deps.fetch(`${deps.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new SupabaseError(`${name} could not be reached`, { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`${name} answered ${response.status}`);
  }
  return await response.json();
}

/**
 * The webhook's Authorization value and the RevenueCat API key. Throws [SupabaseError] when the
 * database cannot be reached or answers in another shape; nothing it says or throws holds a secret.
 */
export async function secrets(deps: SupabaseDeps): Promise<Secrets> {
  const rows = await rpc("store_secrets", {}, deps);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (typeof row !== "object" || row === null) {
    throw new SupabaseError("store_secrets answered no row");
  }
  const webhook: unknown = "webhook_authorization" in row
    ? row.webhook_authorization
    : null;
  const key: unknown = "api_key" in row ? row.api_key : null;
  if (
    (webhook !== null && typeof webhook !== "string") ||
    (key !== null && typeof key !== "string")
  ) {
    throw new SupabaseError("store_secrets answered a bad secret");
  }
  return { webhookAuthorization: webhook, apiKey: key };
}

/**
 * Sets the user's store grant to [plan] until [endsAt] and renewing there, or ends it when [plan]
 * is null. Throws [SupabaseError] when the database cannot be reached or answers another outcome,
 * `bad_plan` included.
 */
export async function apply(
  userId: string,
  plan: "pro" | null,
  endsAt: string | null,
  renews: boolean,
  deps: SupabaseDeps,
): Promise<Applied> {
  const answer = await rpc("apply_store_entitlement", {
    user_id: userId,
    plan,
    ends_at: endsAt,
    renews,
  }, deps);
  if (
    answer === "granted" || answer === "changed" || answer === "ended" ||
    answer === "unchanged" || answer === "no_user"
  ) {
    return answer;
  }
  throw new SupabaseError("apply_store_entitlement answered another outcome");
}

/**
 * Records a call of the sync route by [userId] and answers whether it may go on, 10 calls in 10
 * minutes. Throws [SupabaseError] when the database cannot be reached or answers another shape.
 */
export async function begin(
  userId: string,
  deps: SupabaseDeps,
): Promise<boolean> {
  const answer = await rpc("store_sync_begin", { user_id: userId }, deps);
  if (typeof answer !== "boolean") {
    throw new SupabaseError("store_sync_begin answered another shape");
  }
  return answer;
}
