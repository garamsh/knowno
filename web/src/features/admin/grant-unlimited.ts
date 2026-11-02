"use server";

import { revalidatePath } from "next/cache";

import { studyDayEnd, studyDayStart } from "@/features/study";

import { call, failureMessages, parseUserId } from "./action-call";
import { adminTimeZone } from "./read-admin";

/** What a user's 무제한 form shows after an attempt. */
export type GrantUnlimitedState = { message: string | null };

/**
 * Grants the form's `user` 무제한 until the end of the study day of `ends_on` in the admin's zone,
 * or without an end when it is empty (ADR 0157).
 */
export async function grantUnlimited(
  _previous: GrantUnlimitedState,
  form: FormData,
): Promise<GrantUnlimitedState> {
  const userId = parseUserId(form.get("user"));
  const endsOn = form.get("ends_on");
  if (userId === null) return { message: failureMessages.malformed };
  let endsAt: string | null = null;
  if (typeof endsOn === "string" && endsOn !== "") {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsOn);
    if (!date) return { message: failureMessages.malformed };
    const timeZone = await adminTimeZone();
    // Noon UTC falls on the same calendar date in every zone within 11 hours of UTC.
    const noon = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), 12);
    endsAt = new Date(studyDayEnd(studyDayStart(noon, timeZone), timeZone)).toISOString();
  }
  const result = await call("admin_grant_unlimited", { user_id: userId, ends_at: endsAt });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  switch (result.data) {
    case "granted":
      revalidatePath("/admin", "layout");
      return { message: "무제한으로 지정했어요." };
    case "bad_end":
      return { message: "끝나는 날은 오늘 이후로 정해 주세요." };
    case "no_user":
      return { message: "없는 사용자예요." };
    default:
      return { message: failureMessages.unreadable };
  }
}
