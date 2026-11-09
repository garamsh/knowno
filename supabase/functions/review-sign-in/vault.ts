/**
 * The review address and its code in Vault, behind the attempt limit, through
 * `public.review_sign_in_begin` (ADR 0226).
 */

import { type SupabaseDeps, SupabaseError } from "../_shared/auth.ts";

/**
 * What one attempt may do: `limited` when the address or the whole function has tried too often,
 * else the two secrets, each null while the owner has set none.
 */
export type Begin =
  | { readonly kind: "limited" }
  | {
    readonly kind: "allowed";
    readonly email: string | null;
    readonly code: string | null;
  };

/**
 * Records an attempt by [addressKey], the hex SHA-256 of the address tried, and answers whether it
 * may go on. Throws [SupabaseError] when the database cannot be reached or answers in another
 * shape; nothing it says or throws holds a secret.
 */
export async function begin(
  addressKey: string,
  deps: SupabaseDeps,
): Promise<Begin> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/review_sign_in_begin`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address_key: addressKey }),
    },
  ).catch((cause: unknown) => {
    throw new SupabaseError("review_sign_in_begin could not be reached", {
      cause,
    });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`review_sign_in_begin answered ${response.status}`);
  }
  const rows: unknown = await response.json();
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (typeof row !== "object" || row === null || !("allowed" in row)) {
    throw new SupabaseError("review_sign_in_begin answered no row");
  }
  if (row.allowed === false) return { kind: "limited" };
  if (row.allowed !== true) {
    throw new SupabaseError("review_sign_in_begin answered no verdict");
  }
  const email: unknown = "email" in row ? row.email : null;
  const code: unknown = "code" in row ? row.code : null;
  if (
    (email !== null && typeof email !== "string") ||
    (code !== null && typeof code !== "string")
  ) {
    throw new SupabaseError("review_sign_in_begin answered a bad secret");
  }
  return { kind: "allowed", email, code };
}
