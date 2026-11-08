import "server-only";

import { requestTimeoutMs } from "@/supabase/failure";
import { createClient } from "@/supabase/server";

import type { Allowance } from "./protocol";

/**
 * The signed-in user's tokens today through `assistant_allowance()`, or null where it answers no
 * row, the user having no plan, or cannot be read: the chat then shows no share until a message's
 * `usage` brings one.
 */
export async function readAllowance(): Promise<Allowance | null> {
  const supabase = await createClient();
  const read = await supabase
    .rpc("assistant_allowance")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  const row: unknown = Array.isArray(read.data) ? read.data[0] : null;
  if (read.error || typeof row !== "object" || row === null) return null;
  const budget: unknown = "token_budget" in row ? row.token_budget : undefined;
  const used: unknown = "tokens_used" in row ? row.tokens_used : undefined;
  // bigint columns may arrive as numbers or, past 2^53, as text; a day's budget is far below it.
  const number = (value: unknown) =>
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  const tokensUsed = number(used);
  const tokenBudget = budget === null ? null : number(budget);
  if (!Number.isFinite(tokensUsed) || (tokenBudget !== null && !Number.isFinite(tokenBudget)))
    return null;
  return { tokenBudget, tokensUsed };
}
