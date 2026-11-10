"use server";

import { revalidatePath } from "next/cache";

import { failureMessages } from "./action-call";
import { type AiFormState, postSettings } from "./ai-settings";
import { checkModelId } from "./model-id";
import { parseProvider, type Provider } from "./read-admin";

const rate = /^\d{1,4}(\.\d{1,6})?$/;

type Tier = { provider: Provider; model: string; in_usd: number; out_usd: number };

function tier(form: FormData, prefix: "cheap" | "strong"): { tier: Tier } | { message: string } {
  const provider = parseProvider(form.get(`${prefix}_provider`));
  const model = provider === null ? null : checkModelId(provider, form.get(`${prefix}_model`));
  const inUsd = form.get(`${prefix}_in_usd`);
  const outUsd = form.get(`${prefix}_out_usd`);
  if (provider === null || model === null) return { message: failureMessages.malformed };
  if ("message" in model) return { message: model.message };
  if (
    typeof inUsd !== "string" ||
    typeof outUsd !== "string" ||
    !rate.test(inUsd.trim()) ||
    !rate.test(outUsd.trim()) ||
    Number(inUsd) > 1000 ||
    Number(outUsd) > 1000
  ) {
    return { message: "가격은 0에서 1,000달러 사이로 적어 주세요." };
  }
  return {
    tier: { provider, model: model.id, in_usd: Number(inUsd), out_usd: Number(outUsd) },
  };
}

/**
 * Saves the form's configuration as the triage's one draft, after one call per tier with the
 * provider's key parsed (ADR 0244): the cheap and the strong tier's provider, model and USD per
 * million tokens in and out, the prompt (at most 8000 characters), the confidence below which the
 * strong tier judges, the payload's tokens and the cards sampled. It reaches the AI only once
 * an admin applies it.
 */
export async function saveTriageConfiguration(
  _previous: AiFormState,
  form: FormData,
): Promise<AiFormState> {
  const cheap = tier(form, "cheap");
  if ("message" in cheap) return { message: cheap.message, reauth: false };
  const strong = tier(form, "strong");
  if ("message" in strong) return { message: strong.message, reauth: false };
  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || prompt.trim() === "" || prompt.trim().length > 8000) {
    return { message: "프롬프트는 1자에서 8,000자 사이로 적어 주세요.", reauth: false };
  }
  const escalate = form.get("escalate_below");
  if (typeof escalate !== "string" || !/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/.test(escalate.trim())) {
    return { message: "강한 모델로 넘기는 기준은 0에서 1 사이로 적어 주세요.", reauth: false };
  }
  const payload = form.get("payload_tokens");
  if (typeof payload !== "string" || !/^\d{3,5}$/.test(payload.trim())) {
    return { message: "글 길이는 500에서 20,000 토큰 사이로 적어 주세요.", reauth: false };
  }
  const payloadTokens = Number(payload.trim());
  if (payloadTokens < 500 || payloadTokens > 20_000) {
    return { message: "글 길이는 500에서 20,000 토큰 사이로 적어 주세요.", reauth: false };
  }
  const cards = form.get("sample_cards");
  if (typeof cards !== "string" || !/^\d{1,2}$/.test(cards.trim()) || Number(cards) > 50) {
    return { message: "살펴볼 카드는 0에서 50장 사이로 적어 주세요.", reauth: false };
  }
  const result = await postSettings("triage-reports/settings/configuration", {
    cheap: cheap.tier,
    strong: strong.tier,
    prompt: prompt.trim(),
    escalate_below: Number(escalate.trim()),
    payload_tokens: payloadTokens,
    sample_cards: Number(cards.trim()),
  });
  if (!result.saved) return result.state;
  revalidatePath("/admin", "layout");
  return { message: "확인하고 초안으로 저장했어요. 적용하기 전에는 쓰이지 않아요.", reauth: false };
}
