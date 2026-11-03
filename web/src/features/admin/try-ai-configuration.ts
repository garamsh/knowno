"use server";

import { adminToken, runTrial, type TrialResult, trialPhoto } from "./trial";

/** The draft's cards beside the active configuration's on the same photo. */
export type ComparedTrial = { draft: TrialResult; active: TrialResult } | { message: string };

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Runs extract-cards on the form's `photo` twice at once as the signed-in admin (ADR 0162): with
 * the draft [draftId] and with the active configuration [activeId] of the same plan, each served
 * the prompt an admin is served. Each photo is recorded as any extraction is; no limit applies to
 * an admin. A user who is not an admin is refused before the function is called.
 */
export async function tryAiConfiguration(
  draftId: number,
  activeId: number,
  form: FormData,
): Promise<ComparedTrial> {
  if (!isId(draftId) || !isId(activeId))
    return { message: "하지 못했어요. 잠시 후 다시 시도해 주세요." };
  const photo = trialPhoto(form);
  if (photo === null) return { message: "JPEG, PNG 또는 WebP 사진을 골라 주세요." };
  const admin = await adminToken();
  if ("message" in admin) return admin;
  const [draft, active] = await Promise.all([
    runTrial(photo, admin.token, draftId),
    runTrial(photo, admin.token, activeId),
  ]);
  return { draft, active };
}
