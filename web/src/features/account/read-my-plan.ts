import "server-only";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

/**
 * The signed-in user's plan as `my_plan()` answers it: 스페셜 is `max`. `source` is where the plan
 * comes from; an `admin` or `unlimited` user is never locked from AI 연결 or offered a purchase.
 */
export type MyPlan = {
  plan: "free" | "pro" | "max";
  source: "none" | "store" | "admin" | "unlimited";
  /** A store plan's last day, as milliseconds since the epoch; null for any other. */
  endsAt: number | null;
  renews: boolean;
  /** The photos the period allows, null where none is limited. */
  photoLimit: number | null;
  used: number;
};

/** Reads `my_plan()`, or null while it fails or the plan is unknown: nothing is then offered or locked. */
export async function readMyPlan(): Promise<MyPlan | null> {
  const client = await createClient();
  if ("failure" in (await readUserId(client))) return null;
  const result = await client.rpc("my_plan").abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (result.error) return null;
  const row: unknown = Array.isArray(result.data) ? result.data[0] : null;
  const plan = field(row, "plan");
  const source = field(row, "source");
  const endsAt = field(row, "ends_at");
  const renews = field(row, "renews");
  const photoLimit = field(row, "photo_limit");
  const used = field(row, "used");
  if (plan !== "free" && plan !== "pro" && plan !== "max") return null;
  if (source !== "none" && source !== "store" && source !== "admin" && source !== "unlimited") {
    return null;
  }
  const end = typeof endsAt === "string" ? Date.parse(endsAt) : null;
  if (end !== null && Number.isNaN(end)) return null;
  if (photoLimit !== null && (typeof photoLimit !== "number" || photoLimit < 0)) return null;
  if (typeof used !== "number" || used < 0) return null;
  return { plan, source, endsAt: end, renews: renews === true, photoLimit, used };
}

/** Whether MCP is refused to [plan]'s user: a 무료 user who is neither an admin nor 무제한. */
export function mcpLocked(plan: MyPlan | null): boolean {
  return plan !== null && plan.plan === "free" && plan.source === "none";
}
