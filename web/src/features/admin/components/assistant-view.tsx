import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { activateAssistantConfiguration } from "../activate-assistant-configuration";
import { clearAssistantTest } from "../clear-assistant-test";
import { formatTime } from "../format";
import {
  type CardForm,
  effortLabels,
  labelOf,
  planLabels,
  providerLabels,
  tokenBudgetLabel,
} from "../labels";
import type {
  AssistantBudget,
  AssistantConfiguration,
  PlanId,
  PromptDetail,
  SkillVersion,
} from "../read-admin";
import { saveAssistantPrompt } from "../save-assistant-prompt";
import { button, group, Parts, row } from "./admin-section";
import { AdminTable, CellLabel, cellClass, rowClass } from "./admin-table";
import { AssistantBudgetForm } from "./assistant-budget-form";
import { AssistantConfigurationForm } from "./assistant-configuration-form";
import { ConfirmAction } from "./confirm-action";
import { PromptChanges } from "./prompt-changes";
import { PromptForm } from "./prompt-form";
import { PromptVersions } from "./prompt-versions";
import { SkillList, SkillPanel } from "./skills";

const assistantPlans: readonly PlanId[] = ["free", "pro", "max", "special"];

const plansHead = [
  { label: "요금제" },
  { label: "제공자" },
  { label: "모델" },
  { label: "프롬프트" },
  { label: "웹 검색" },
  { label: "추론" },
  { label: "하루 토큰", align: "end" },
  { label: "초안", align: "center" },
  { label: "작업" },
] as const;

/** 말랑이's address with [plan]'s panel open and, with [write], the new version's form from it. */
function assistantHref(plan: PlanId, write?: number | "active"): string {
  const params = new URLSearchParams({ plan });
  if (write !== undefined) params.set("write", write === "active" ? "" : String(write));
  return `/assistant?${params.toString()}`;
}

/** 말랑이's address with [plan]'s panel open and [form]'s skill panel, from version [from] of it. */
function skillHref(plan: PlanId, form: CardForm, from?: number): string {
  const params = new URLSearchParams({ plan, skill: form });
  if (from !== undefined) params.set("from", String(from));
  return `/assistant?${params.toString()}`;
}

/** A configuration's web search in words: "메시지당 3회", or "끔". */
function searchWords(configuration: AssistantConfiguration): string {
  return configuration.webSearch ? `메시지당 ${String(configuration.maxSearches)}회` : "끔";
}

/** The parts of [configuration] a draft may change, each named, in the order the form asks them. */
function parts(configuration: AssistantConfiguration) {
  return [
    { name: "제공자", value: labelOf(providerLabels, configuration.provider) },
    { name: "모델", value: configuration.model },
    { name: "프롬프트", value: `v${String(configuration.promptVersionId)}` },
    { name: "웹 검색", value: searchWords(configuration) },
    { name: "추론", value: labelOf(effortLabels, configuration.reasoningEffort) },
  ];
}

/** [configuration] in words, as "OpenRouter · <model> · 프롬프트 v1 · 웹 검색 끔 · 추론 없음". */
function describe(configuration: AssistantConfiguration): string {
  return parts(configuration)
    .map((part, index) => (index < 2 ? part.value : `${part.name} ${part.value}`))
    .join(" · ");
}

/** What [draft] changes against [active], as "제공자·모델·웹 검색·추론 그대로 · 프롬프트 v1 → v2". */
function changes(active: AssistantConfiguration | null, draft: AssistantConfiguration): string {
  if (active === null) return describe(draft);
  const before = parts(active);
  const after = parts(draft);
  const kept = after.filter((part, index) => part.value === before[index]?.value);
  const changed = after
    .map((part, index) => ({ ...part, before: before[index]?.value }))
    .filter((part) => part.value !== part.before)
    .map((part) => `${part.name} ${part.before ?? ""} → ${part.value}`);
  if (changed.length === 0) return "지금 구성과 같아요";
  return [
    ...(kept.length === 0 ? [] : [`${kept.map((part) => part.name).join("·")} 그대로`]),
    ...changed,
  ].join(" · ");
}

/** A daily token budget in words: "200,000", or "제한 없음". */
function budgetWords(budget: AssistantBudget | undefined): string {
  if (budget === undefined) return "—";
  return budget.dailyTokens === null ? "제한 없음" : budget.dailyTokens.toLocaleString("ko-KR");
}

/**
 * 말랑이 (ADR 0190, ADR 0196): each plan's active assistant configuration, its provider, model,
 * prompt version, web search, reasoning effort and daily token budget, with its draft; the chosen
 * plan's draft against it, its prompt's lines, 테스트 끝내기 and 모두에게 적용, the form for a new
 * draft, and its budget's form; beside them the assistant's prompt versions, with the form for a
 * new version while [write] is open, and the card forms' skills (ADR 0212), with a form's panel
 * above the plan's while [skill] names it.
 */
export function AssistantView({
  configurations,
  prompts,
  budgets,
  plan,
  write,
  skills,
  skill,
  timeZone,
}: {
  configurations: AssistantConfiguration[];
  /** Every assistant prompt with its text, newest first. */
  prompts: PromptDetail[];
  budgets: AssistantBudget[];
  /** The plan whose panel is shown. */
  plan: PlanId;
  /** The new version's form, from the version it starts with, or empty; null while closed. */
  write: { from: PromptDetail | null } | null;
  /** Every saved card-form skill version, newest first. */
  skills: SkillVersion[];
  /** The card form whose skill panel is open, from the version it starts with or none; null while closed. */
  skill: { form: CardForm; from: SkillVersion | null } | null;
  timeZone: string;
}) {
  const find = (of: PlanId, label: "active" | "test") =>
    configurations.find((c) => c.plan === of && c.label === label) ?? null;
  return (
    <div className="flex flex-col gap-section-gap">
      <Section
        label="요금제별 사용 중인 구성"
        note="하루 토큰은 Asia/Seoul 날짜 기준으로, 메시지마다 입력과 출력 토큰을 더해요."
      >
        <AdminTable label="요금제별 사용 중인 구성" head={plansHead}>
          {assistantPlans.map((shown) => {
            const active = find(shown, "active");
            const draft = find(shown, "test");
            return (
              <tr key={shown} className={rowClass({ current: shown === plan })}>
                <td className={`${cellClass({ lead: true })} text-body-strong`}>
                  {planLabels[shown] ?? shown}
                </td>
                <td className={cellClass()}>
                  <CellLabel>제공자</CellLabel>
                  {active === null ? "구성 없음" : labelOf(providerLabels, active.provider)}
                </td>
                <td className={`${cellClass()} break-words`}>
                  <CellLabel>모델</CellLabel>
                  <Parts text={active?.model ?? "—"} />
                </td>
                <td className={cellClass()}>
                  <CellLabel>프롬프트</CellLabel>
                  {active === null ? "—" : `v${String(active.promptVersionId)}`}
                </td>
                <td className={cellClass()}>
                  <CellLabel>웹 검색</CellLabel>
                  {active === null ? "—" : searchWords(active)}
                </td>
                <td className={cellClass()}>
                  <CellLabel>추론</CellLabel>
                  {active === null ? "—" : labelOf(effortLabels, active.reasoningEffort)}
                </td>
                <td className={cellClass({ align: "end" })}>
                  <CellLabel>하루 토큰</CellLabel>
                  {budgetWords(budgets.find((budget) => budget.plan === shown))}
                </td>
                <td className={cellClass({ align: "center" })}>
                  <CellLabel>초안</CellLabel>
                  {draft === null ? "—" : <Chip>테스트 중</Chip>}
                </td>
                <td className={`${cellClass()} max-lg:basis-full`}>
                  <Link href={assistantHref(shown)} className={`${button.row} my-1`}>
                    {draft === null ? "바꾸기" : "초안 보기"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      </Section>
      <div className="grid grid-cols-1 items-start gap-section-gap lg:grid-cols-[minmax(0,1fr)_--spacing(90)] lg:gap-4">
        <div className="flex min-w-0 flex-col gap-section-gap">
          {write !== null && (
            <PromptForm
              initialText={write.from?.text ?? ""}
              note={`${
                write.from === null ? "빈 프롬프트" : `버전 ${String(write.from.id)}`
              }에서 시작해요. 저장해도 바로 쓰이지 않아요: 초안의 프롬프트로 골라 적용해요.`}
              save={saveAssistantPrompt}
            />
          )}
          {skill !== null && (
            <SkillPanel
              form={skill.form}
              skills={skills}
              from={skill.from}
              fromHref={(id) => skillHref(plan, skill.form, id)}
              timeZone={timeZone}
            />
          )}
          <Panel
            plan={plan}
            active={find(plan, "active")}
            draft={find(plan, "test")}
            prompts={prompts}
            timeZone={timeZone}
          />
          <Budget
            plan={plan}
            budget={budgets.find((budget) => budget.plan === plan)}
            timeZone={timeZone}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-section-gap">
          <PromptVersions
            versions={prompts}
            writeHref={(from) => assistantHref(plan, from)}
            timeZone={timeZone}
          />
          <SkillList skills={skills} href={(form) => skillHref(plan, form)} />
        </div>
      </div>
    </div>
  );
}

/**
 * One plan's panel: its draft against its active configuration, the lines its prompt changes,
 * collapsed, 테스트 끝내기 and 모두에게 적용, each asked first, then the form for a new draft;
 * without a draft, its active configuration and the same form.
 */
function Panel({
  plan,
  active,
  draft,
  prompts,
  timeZone,
}: {
  plan: PlanId;
  active: AssistantConfiguration | null;
  draft: AssistantConfiguration | null;
  prompts: PromptDetail[];
  timeZone: string;
}) {
  const name = planLabels[plan] ?? plan;
  const basis = draft ?? active;
  const textOf = (id: number) => prompts.find((prompt) => prompt.id === id)?.text;
  const before = active === null ? undefined : textOf(active.promptVersionId);
  const after = draft === null ? undefined : textOf(draft.promptVersionId);
  return (
    <Section
      label={draft === null ? `${name} · 사용 중인 구성` : `${name} · 초안 (관리자만 테스트 중)`}
    >
      <div className={group}>
        <div className={row}>
          <h3 className="text-headline break-words">
            <Parts
              text={
                draft === null
                  ? active === null
                    ? "사용 중인 구성이 없어요"
                    : describe(active)
                  : changes(active, draft)
              }
            />
          </h3>
          {draft !== null && active !== null && (
            <p className="text-caption text-muted break-words">
              지금 구성: <Parts text={describe(active)} />
            </p>
          )}
          {draft !== null && (
            <p className="text-caption text-muted">
              관리자만 써요 · {formatTime(draft.createdAt, timeZone)}
              {draft.createdByEmail === null ? "" : ` · ${draft.createdByEmail}`}
            </p>
          )}
        </div>
        {active !== null &&
          draft !== null &&
          active.promptVersionId !== draft.promptVersionId &&
          before !== undefined &&
          after !== undefined && (
            <PromptChanges
              from={active.promptVersionId}
              to={draft.promptVersionId}
              before={before}
              after={after}
            />
          )}
        {draft !== null && (
          <div className="flex flex-wrap items-start gap-2 px-4 py-3">
            <ConfirmAction
              label="테스트 끝내기"
              question="테스트를 끝낼까요? 관리자도 지금 구성을 쓰게 돼요."
              confirmLabel="끝내기"
              action={clearAssistantTest.bind(null, plan)}
            />
            <ConfirmAction
              primary
              label="모두에게 적용"
              question={`${name} 사용자 모두에게 이 초안을 적용할까요?`}
              confirmLabel="적용"
              action={activateAssistantConfiguration.bind(null, plan)}
            />
          </div>
        )}
      </div>
      <h3 className="mt-3 px-1 text-section text-muted">새 초안</h3>
      <AssistantConfigurationForm
        key={plan}
        plan={plan}
        name={name}
        start={{
          provider: basis?.provider ?? "openrouter",
          model: basis?.model ?? "",
          promptVersionId: basis?.promptVersionId ?? prompts[0]?.id ?? 0,
          webSearch: basis?.webSearch ?? false,
          maxSearches: basis?.maxSearches ?? 3,
          reasoningEffort: basis?.reasoningEffort ?? "none",
        }}
        versions={prompts.map((prompt) => prompt.id)}
      />
    </Section>
  );
}

/** One plan's daily token budget, who set it and when, and the form that sets it. */
function Budget({
  plan,
  budget,
  timeZone,
}: {
  plan: PlanId;
  budget: AssistantBudget | undefined;
  timeZone: string;
}) {
  const name = planLabels[plan] ?? plan;
  return (
    <Section label={`${name} · 하루 토큰 예산`} note="바꾸면 다음 메시지부터 적용돼요.">
      <div className={group}>
        <div className={row}>
          <p className="text-headline">
            {budget === undefined ? "예산이 없어요" : tokenBudgetLabel(budget.dailyTokens)}
          </p>
          {budget !== undefined && (
            <p className="text-caption text-muted">
              {formatTime(budget.setAt, timeZone)}
              {budget.setByEmail === null ? "" : ` · ${budget.setByEmail}`}
            </p>
          )}
        </div>
      </div>
      {budget !== undefined && (
        <AssistantBudgetForm key={plan} plan={plan} name={name} tokens={budget.dailyTokens} />
      )}
    </Section>
  );
}
