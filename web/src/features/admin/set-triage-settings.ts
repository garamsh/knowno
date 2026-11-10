"use server";

import { revalidatePath } from "next/cache";

import { call, failureMessages } from "./action-call";

/** What the triage settings form shows after an attempt. */
export type TriageSettingsState = { message: string | null };

/** [value] as a number in [low, high] with at most [places] decimals, or null. */
function numberIn(value: FormDataEntryValue | null, low: number, high: number, places: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const decimals = places === 0 ? "" : `(\\.\\d{1,${String(places)}})?`;
  if (!new RegExp(`^\\d+${decimals}$`).test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= low && parsed <= high ? parsed : null;
}

/**
 * Sets the triage's confidence threshold (0.5 to 1), daily spend cap (USD, 0 to 1000), notes
 * judged a day (0 to 10,000), re-check sample (percent, 0 to 100) and reports one person may make a
 * day (1 to 1000). The mode is not here: it has its own switch. The server checks the role and
 * the ranges, and records the new values.
 */
export async function setTriageSettings(
  _previous: TriageSettingsState,
  form: FormData,
): Promise<TriageSettingsState> {
  const threshold = numberIn(form.get("act_threshold"), 0.5, 1, 2);
  if (threshold === null) return { message: "확신 기준은 0.5에서 1 사이로 적어 주세요." };
  const cap = numberIn(form.get("daily_cap_usd"), 0, 1000, 2);
  if (cap === null) return { message: "하루 비용 한도는 0에서 1,000달러 사이로 적어 주세요." };
  const notes = numberIn(form.get("daily_notes"), 0, 10_000, 0);
  if (notes === null) return { message: "하루 판단 수는 0에서 10,000 사이로 적어 주세요." };
  const sample = numberIn(form.get("sample_percent"), 0, 100, 0);
  if (sample === null) return { message: "다시 확인 비율은 0에서 100 사이로 적어 주세요." };
  const reports = numberIn(form.get("reporter_daily_cap"), 1, 1000, 0);
  if (reports === null) return { message: "하루 신고 수는 1에서 1,000 사이로 적어 주세요." };
  const result = await call("admin_set_triage_settings", {
    act_threshold: threshold,
    daily_cap_usd: cap,
    daily_notes: notes,
    sample_percent: sample,
    reporter_daily_cap: reports,
  });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  if (result.data !== true) return { message: failureMessages.unreadable };
  revalidatePath("/admin", "layout");
  return { message: "설정을 바꿨어요." };
}
