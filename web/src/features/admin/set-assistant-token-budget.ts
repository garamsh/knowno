"use server";

import { revalidatePath } from "next/cache";

import { call, failureMessages } from "./action-call";
import { parsePlanId } from "./read-admin";

/** What the budget form shows after an attempt. */
export type BudgetFormState = { message: string | null };

const outOfRange = "토큰 수는 0에서 10억 사이로 적어 주세요.";

/**
 * Sets the form's `plan`'s daily assistant token budget to its `daily_tokens`, or to none while
 * `none` is checked (ADR 0195). It applies from the next message. The server checks the role and
 * the range, and records the change.
 */
export async function setAssistantTokenBudget(
  _previous: BudgetFormState,
  form: FormData,
): Promise<BudgetFormState> {
  const plan = parsePlanId(form.get("plan"));
  if (plan === null) return { message: failureMessages.malformed };
  const tokens = form.get("daily_tokens");
  let budget: number | null = null;
  if (form.get("none") !== "on") {
    if (typeof tokens !== "string" || !/^\d{1,10}$/.test(tokens.trim())) {
      return { message: outOfRange };
    }
    budget = Number(tokens.trim());
    if (budget > 1_000_000_000) return { message: outOfRange };
  }
  const result = await call("admin_set_assistant_token_budget", { plan, daily_tokens: budget });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  switch (result.data) {
    case "set":
      revalidatePath("/admin", "layout");
      return { message: "하루 토큰 예산을 바꿨어요. 다음 메시지부터 적용돼요." };
    case "unchanged":
      return { message: "지금 예산과 같아요." };
    case "bad_budget":
      return { message: outOfRange };
    case "bad_plan":
      return { message: failureMessages.malformed };
    default:
      return { message: failureMessages.unreadable };
  }
}
