"use server";

import { adminToken, runTrial, type TrialResult, trialPhoto } from "./trial";

/**
 * Runs extract-cards on the form's `photo` as the signed-in admin, who is served the test version
 * when one is set and the active one otherwise (ADR 0073). No photo limit applies to an admin, on
 * 스페셜 (ADR 0177); the photo is recorded with its version, as any extraction is. A user who is not an admin
 * is refused before the function is called.
 */
export async function tryPrompt(form: FormData): Promise<TrialResult> {
  const photo = trialPhoto(form);
  if (photo === null) return { message: "JPEG, PNG 또는 WebP 사진을 골라 주세요." };
  const admin = await adminToken();
  if ("message" in admin) return admin;
  return await runTrial(photo, admin.token, null);
}
