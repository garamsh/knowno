"use server";

import { revalidatePath } from "next/cache";

import { studyDayEnd, studyDayStart } from "@/features/study";

import { call, failureMessages, parseUserId } from "./action-call";
import { adminTimeZone } from "./read-admin";

/** What a user's plan form shows after an attempt. */
export type GrantPlanState = { message: string | null };

/** What the form says once it granted each plan. */
const granted = {
  pro: "프로로 지정했어요.",
  max: "맥스로 지정했어요.",
  special: "스페셜로 지정했어요.",
} as const;

/**
 * Puts the form's `user` on its `plan`, Pro, Max or 스페셜, Max and 스페셜 until the end of the
 * study day of `ends_on` in the admin's zone, or without an end when it is empty.
 */
export async function grantPlan(
  _previous: GrantPlanState,
  form: FormData,
): Promise<GrantPlanState> {
  const userId = parseUserId(form.get("user"));
  const plan = form.get("plan");
  const endsOn = form.get("ends_on");
  if (userId === null || (plan !== "pro" && plan !== "max" && plan !== "special")) {
    return { message: failureMessages.malformed };
  }
  let endsAt: string | null = null;
  if (typeof endsOn === "string" && endsOn !== "") {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsOn);
    if (plan === "pro" || !date) {
      return { message: "끝나는 날은 맥스와 스페셜에만 정할 수 있어요." };
    }
    const timeZone = await adminTimeZone();
    // Noon UTC falls on the same calendar date in every zone within 11 hours of UTC.
    const noon = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), 12);
    endsAt = new Date(studyDayEnd(studyDayStart(noon, timeZone), timeZone)).toISOString();
  }
  const result = await call("admin_grant_plan", { user_id: userId, plan, ends_at: endsAt });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  switch (result.data) {
    case "granted":
      revalidatePath("/admin", "layout");
      return { message: granted[plan] };
    case "bad_plan":
      return { message: "끝나는 날은 오늘 이후로 정해 주세요." };
    case "no_user":
      return { message: "없는 사용자예요." };
    default:
      return { message: failureMessages.unreadable };
  }
}
