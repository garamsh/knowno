import { Chip } from "@/design/chip";

import { activateAiConfiguration } from "../activate-ai-configuration";
import { clearAiTest } from "../clear-ai-test";
import { formatTime } from "../format";
import { labelOf, planLabels, providerLabels } from "../labels";
import { estimatedCost, measuredModels, usdPerPhoto } from "../model-costs";
import type { AiConfiguration, PlanId, Provider, ProviderKey } from "../read-admin";
import { removeProviderKey } from "../remove-provider-key";
import { Section } from "@/design/section";
import { group, row } from "./admin-section";
import { AiConfigurationForm } from "./ai-configuration-form";
import { AiTrial } from "./ai-trial";
import { ConfirmAction } from "./confirm-action";
import { ProviderKeyForm } from "./provider-key-form";

const plans: PlanId[] = ["free", "pro", "max", "special"];

/** The model a provider's key is checked with when no active configuration names one. */
const checkModels: Record<Provider, string> = {
  openrouter: "anthropic/claude-haiku-5.5",
  openai: "",
  anthropic: "claude-haiku-5-5",
};

function Serving({ configuration }: { configuration: AiConfiguration }) {
  const usd = usdPerPhoto(configuration.model);
  return (
    <>
      <p className="text-body-strong break-all">
        {labelOf(providerLabels, configuration.provider)} · {configuration.model}
      </p>
      <p className="text-caption text-muted">
        {usd === null
          ? "이 모델은 측정한 비용이 없어요."
          : `측정 비용 사진 한 장에 ${estimatedCost(1, usd)}`}
      </p>
    </>
  );
}

/**
 * 설정 → AI 제공자 (ADR 0162): each provider's key, write-only, by its last four characters; and each
 * plan's active configuration, its draft served to admins with 사진 한 장으로 시험 against the
 * active one, 모두에게 적용 and 테스트 끝내기, and the form for a new draft.
 */
export function AiSettingsView({
  keys,
  configurations,
  prompt,
  timeZone,
}: {
  keys: ProviderKey[];
  configurations: AiConfiguration[];
  /** The prompt an admin's trial is served, in words. */
  prompt: string;
  timeZone: string;
}) {
  const active = (plan: PlanId) =>
    configurations.find((c) => c.plan === plan && c.label === "active") ?? null;
  return (
    <div className="flex flex-col gap-section-gap">
      <Section
        label="제공자 키"
        note="키는 저장한 뒤 다시 볼 수 없고, 끝 네 자리만 보여요. 저장과 삭제는 10분 안에 로그인한 관리자만 할 수 있어요."
      >
        <ul aria-label="제공자 키" className={group}>
          {keys.map((entry) => {
            const name = labelOf(providerLabels, entry.provider);
            const model =
              configurations.find((c) => c.label === "active" && c.provider === entry.provider)
                ?.model ?? checkModels[entry.provider];
            return (
              <li key={entry.provider} className={`${row} gap-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-strong">{name}</span>
                  {entry.inUse && <Chip tone="brand">사용 중</Chip>}
                </div>
                <p className="text-caption text-muted">
                  {entry.key === null
                    ? "키 없음 · 이 제공자는 쓸 수 없어요"
                    : `끝자리 ${entry.key.lastFour} · ${formatTime(entry.key.setAt, timeZone)}${
                        entry.key.setByEmail === null ? "" : ` · ${entry.key.setByEmail}`
                      }`}
                </p>
                <ProviderKeyForm
                  provider={entry.provider}
                  name={name}
                  model={model}
                  replacing={entry.key !== null}
                />
                {entry.key !== null && (
                  <ConfirmAction
                    label="키 지우기"
                    question={`${name} 키를 지울까요?`}
                    confirmLabel="지우기"
                    disabled={entry.inUse}
                    action={removeProviderKey.bind(null, entry.provider)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <div className="grid items-start gap-section-gap lg:grid-cols-3 lg:gap-4">
        {plans.map((plan) => {
          const name = planLabels[plan] ?? plan;
          const serving = active(plan);
          const draft = configurations.find((c) => c.plan === plan && c.label === "test") ?? null;
          return (
            <Section key={plan} label={name}>
              <div className={group}>
                <div className={row}>
                  <p className="text-caption text-muted">사용 중</p>
                  {serving === null ? (
                    <p className="text-body-strong">사용 중인 설정이 없어요</p>
                  ) : (
                    <Serving configuration={serving} />
                  )}
                </div>
                {draft !== null && (
                  <div className={`${row} gap-2`}>
                    <div className="flex items-center gap-2">
                      <Chip>테스트</Chip>
                      <span className="text-caption text-muted">
                        관리자만 써요 · {formatTime(draft.createdAt, timeZone)}
                        {draft.createdByEmail === null ? "" : ` · ${draft.createdByEmail}`}
                      </span>
                    </div>
                    <Serving configuration={draft} />
                    <div className="flex flex-wrap gap-2">
                      <ConfirmAction
                        compact
                        label="모두에게 적용"
                        question={`${name} 사용자 모두에게 이 설정을 적용할까요?`}
                        confirmLabel="적용"
                        action={activateAiConfiguration.bind(null, plan)}
                      />
                      <ConfirmAction
                        compact
                        label="테스트 끝내기"
                        question="테스트를 끝낼까요?"
                        confirmLabel="끝내기"
                        action={clearAiTest.bind(null, plan)}
                      />
                    </div>
                  </div>
                )}
                {draft !== null && serving !== null && (
                  <AiTrial name={name} draftId={draft.id} activeId={serving.id} prompt={prompt} />
                )}
              </div>
              <h3 className="mt-3 px-1 text-section text-muted">새 설정</h3>
              <AiConfigurationForm
                plan={plan}
                name={name}
                provider={(draft ?? serving)?.provider ?? "openrouter"}
                model={(draft ?? serving)?.model ?? ""}
              />
            </Section>
          );
        })}
      </div>
      <Section
        label="측정한 모델"
        note="평가(eval)가 프롬프트 v6, 표본 47장으로 잰 사진 한 장의 비용이에요."
      >
        <ul className={group}>
          {measuredModels.map(({ model, usdPerPhoto: cost }) => (
            <li key={model} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="text-body-strong break-all">{model}</span>
              <span className="text-body tabular-nums">{estimatedCost(1, cost)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
