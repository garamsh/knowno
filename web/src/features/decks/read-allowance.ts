"use server";

import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { field } from "@/supabase/row";
import { requestTimeoutMs } from "@/supabase/failure";

/**
 * The current plan's period and remaining photos, or `unlimited` when no limit applies to the user
 * (an admin, or a 무제한 grant; ADR 0157).
 */
export type Allowance =
  | { kind: "limited"; remaining: number; limit: number; period: "day" | "month" }
  | { kind: "unlimited" };
/** Reads the same allowance as the phone, or null while the read fails; the extraction function enforces the quota. */
export async function readAllowance(): Promise<Allowance | null> {
  const client = await createClient();
  if ("failure" in (await readUserId(client))) return null;
  const result = await client
    .rpc("extraction_allowance")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  const row: unknown = Array.isArray(result.data) ? result.data[0] : null;
  const limit = field(row, "photo_limit");
  const used = field(row, "used");
  const period = field(row, "period");
  if (
    result.error ||
    (limit !== null && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0)) ||
    typeof used !== "number" ||
    !Number.isInteger(used) ||
    used < 0 ||
    (period !== "day" && period !== "month")
  )
    return null;
  if (limit === null) return { kind: "unlimited" };
  return { kind: "limited", remaining: Math.max(0, limit - used), limit, period };
}
