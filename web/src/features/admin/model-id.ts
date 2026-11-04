import type { Provider } from "./read-admin";

/**
 * [value], a form's model id, trimmed when it has [provider]'s form: OpenRouter's `vendor/model`,
 * or one word for the others; otherwise the sentence the form shows.
 */
export function checkModelId(
  provider: Provider,
  value: unknown,
): { id: string } | { message: string } {
  const id = typeof value === "string" ? value.trim() : "";
  const shape = provider === "openrouter" ? /^[\w.-]+\/[\w.:-]+$/ : /^[\w.:-]+$/;
  if (shape.test(id) && id.length <= 200) return { id };
  return {
    message:
      provider === "openrouter"
        ? "모델 ID는 vendor/model 꼴로 적어 주세요."
        : "모델 ID를 빈칸이나 / 없이 적어 주세요.",
  };
}
