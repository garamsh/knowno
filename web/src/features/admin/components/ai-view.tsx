import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { activateAiConfiguration } from "../activate-ai-configuration";
import { clearAiTest } from "../clear-ai-test";
import { formatDate, formatTime } from "../format";
import { labelOf, planLabels, providerLabels } from "../labels";
import { estimatedCost, usdPerPhoto } from "../model-costs";
import { failureAlarm, percent } from "../outcomes";
import { lineDiff } from "../prompt-diff";
import type {
  AiConfiguration,
  ConfigurationResult,
  PlanId,
  PromptVersion,
  Provider,
  ProviderKey,
} from "../read-admin";
import { removeProviderKey } from "../remove-provider-key";
import { button, Empty, group, linkRow, row } from "./admin-section";
import { AdminTable, CellLabel, cellClass, rowClass } from "./admin-table";
import { AiConfigurationForm } from "./ai-configuration-form";
import { AiTrial } from "./ai-trial";
import { ConfirmAction } from "./confirm-action";
import { PromptForm } from "./prompt-form";
import { ProviderKeyForm } from "./provider-key-form";

const aiPlans: readonly PlanId[] = ["free", "pro", "max", "special"];

/** The model a provider's key is checked with when no active configuration names one. */
const checkModels: Record<Provider, string> = {
  openrouter: "anthropic/claude-haiku-5.5",
  openai: "",
  anthropic: "claude-haiku-5-5",
};

const plansHead = [
  { label: "요금제" },
  { label: "제공자" },
  { label: "모델" },
  { label: "프롬프트" },
  { label: "사진당 비용", numeric: true },
  { label: "실패율 · 7일" },
  { label: "초안" },
  { label: "작업" },
] as const;

const resultsHead = [
  { label: "구성" },
  { label: "호출", numeric: true },
  { label: "카드 없음", numeric: true },
  { label: "형식 오류", numeric: true },
  { label: "모델 오류", numeric: true },
  { label: "실패율", numeric: true },
] as const;

/**
 * AI's address with [plan]'s panel open and, with [write], the new version's form from it, or with
 * [key], that provider's key form.
 */
function aiHref(plan: PlanId, write?: number | "active", key?: Provider): string {
  const params = new URLSearchParams({ plan });
  if (write !== undefined) params.set("write", write === "active" ? "" : String(write));
  if (key !== undefined) params.set("key", key);
  return `/ai?${params.toString()}`;
}

/** Whether [result] counts the photos [configuration] served: the same provider, model and prompt. */
function serves(configuration: AiConfiguration, result: ConfigurationResult): boolean {
  return (
    configuration.provider === result.provider &&
    configuration.model === result.model &&
    configuration.promptVersionId === result.promptVersionId
  );
}

/** A rate in words, drawn red over 5%. */
function Rate({ rate }: { rate: number }) {
  return (
    <span className={rate > failureAlarm ? "text-dont-know-text" : undefined}>{percent(rate)}</span>
  );
}

/** [configuration] in words: its provider, model and prompt version. */
function describe(configuration: AiConfiguration): string {
  return `${labelOf(providerLabels, configuration.provider)} · ${configuration.model} · 프롬프트 v${String(configuration.promptVersionId)}`;
}

/** What [draft] changes against [active], as "제공자·모델 그대로 · 프롬프트 v9 → v10". */
function changes(active: AiConfiguration | null, draft: AiConfiguration): string {
  if (active === null) return describe(draft);
  const parts = [
    {
      name: "제공자",
      before: labelOf(providerLabels, active.provider),
      after: labelOf(providerLabels, draft.provider),
    },
    { name: "모델", before: active.model, after: draft.model },
    {
      name: "프롬프트",
      before: `v${String(active.promptVersionId)}`,
      after: `v${String(draft.promptVersionId)}`,
    },
  ];
  const kept = parts.filter((part) => part.before === part.after).map((part) => part.name);
  const changed = parts
    .filter((part) => part.before !== part.after)
    .map((part) => `${part.name} ${part.before} → ${part.after}`);
  if (changed.length === 0) return "지금 구성과 같아요";
  return [...(kept.length === 0 ? [] : [`${kept.join("·")} 그대로`]), ...changed].join(" · ");
}

/** The words for a version's labels: 사용 중 for an active configuration's, 초안에서 사용 for a draft's. */
function labelWords(version: PromptVersion): string[] {
  return [
    ...(version.labels.includes("active") ? ["사용 중"] : []),
    ...(version.labels.includes("test") ? ["초안에서 사용"] : []),
  ];
}

/**
 * AI (ADR 0162, #650): each plan's active configuration, its provider, model and prompt version,
 * with its cost per photo, its week's failure rate and its draft; the chosen plan's draft against
 * it, its prompt's lines, the trial on one photo, 테스트 끝내기 and 모두에게 적용, and the form for a
 * new draft; beside them the providers' keys and the prompt versions, with the form for a new
 * version while [write] is open; then each configuration's results over 30 days.
 */
export function AiView({
  configurations,
  versions,
  week,
  month,
  keys,
  plan,
  diff,
  write,
  editing,
  timeZone,
}: {
  configurations: AiConfiguration[];
  /** Every prompt version, newest first. */
  versions: PromptVersion[];
  /** Each configuration's results over the last 7 UTC days. */
  week: ConfigurationResult[];
  /** Each configuration's results over the last 30 UTC days. */
  month: ConfigurationResult[];
  keys: ProviderKey[];
  /** The plan whose panel is shown. */
  plan: PlanId;
  /** The texts of the chosen plan's active prompt and its draft's, while the two differ. */
  diff: { before: string; after: string } | null;
  /** The new version's form, from the text it starts with, while the address opens it. */
  write: { text: string; basis: string } | null;
  /** The provider whose key form the address opens, or null. */
  editing: Provider | null;
  timeZone: string;
}) {
  const find = (of: PlanId, label: "active" | "test") =>
    configurations.find((c) => c.plan === of && c.label === label) ?? null;
  return (
    <div className="flex flex-col gap-section-gap">
      <Section label="요금제별 사용 중인 구성">
        <AdminTable label="요금제별 사용 중인 구성" head={plansHead}>
          {aiPlans.map((shown) => {
            const active = find(shown, "active");
            const draft = find(shown, "test");
            const usd = active === null ? null : usdPerPhoto(active.model);
            const result = active === null ? undefined : week.find((r) => serves(active, r));
            return (
              <tr key={shown} className={rowClass({ current: shown === plan })}>
                <td className={`${cellClass({ lead: true })} text-body-strong`}>
                  {planLabels[shown] ?? shown}
                </td>
                <td className={cellClass()}>
                  <CellLabel>제공자</CellLabel>
                  {active === null ? "구성 없음" : labelOf(providerLabels, active.provider)}
                </td>
                <td className={`${cellClass()} break-all`}>
                  <CellLabel>모델</CellLabel>
                  {active?.model ?? "—"}
                </td>
                <td className={cellClass()}>
                  <CellLabel>프롬프트</CellLabel>
                  {active === null ? "—" : `v${String(active.promptVersionId)}`}
                </td>
                <td className={cellClass({ numeric: true })}>
                  <CellLabel>사진당 비용</CellLabel>
                  {usd === null ? "측정 없음" : estimatedCost(1, usd)}
                </td>
                <td className={cellClass()}>
                  <CellLabel>실패율 · 7일</CellLabel>
                  {result?.failureRate == null ? (
                    <Chip>기록 없음</Chip>
                  ) : (
                    <Chip tone={result.failureRate > failureAlarm ? "dontKnow" : "neutral"}>
                      {percent(result.failureRate)}
                    </Chip>
                  )}
                </td>
                <td className={cellClass()}>
                  <CellLabel>초안</CellLabel>
                  {draft === null ? "—" : <Chip>테스트 중</Chip>}
                </td>
                <td className={`${cellClass()} max-lg:basis-full`}>
                  <Link href={aiHref(shown)} className={`${button.row} my-1`}>
                    {draft === null ? "바꾸기" : "초안 보기"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      </Section>
      <div className="grid items-start gap-section-gap lg:grid-cols-[minmax(0,1fr)_--spacing(90)] lg:gap-4">
        <div className="flex min-w-0 flex-col gap-section-gap">
          {write !== null && <PromptForm initialText={write.text} basis={write.basis} />}
          <Panel
            plan={plan}
            active={find(plan, "active")}
            draft={find(plan, "test")}
            versions={versions}
            diff={diff}
            timeZone={timeZone}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-section-gap">
          <ProviderKeys
            keys={keys}
            configurations={configurations}
            plan={plan}
            editing={editing}
            timeZone={timeZone}
          />
          <PromptVersions versions={versions} plan={plan} timeZone={timeZone} />
        </div>
      </div>
      <Section
        label="결과 · 30일 (구성별)"
        note="UTC 날짜 기준이에요. 어느 요금제에서 쓰였든 합쳐요."
      >
        {month.length === 0 ? (
          <Empty>최근 30일에 기록된 추출이 없어요. 사진으로 카드를 만들면 여기에 쌓여요.</Empty>
        ) : (
          <AdminTable label="결과 · 30일 (구성별)" head={resultsHead}>
            {month.map((result) => {
              const marks = [
                ...(configurations.some((c) => c.label === "active" && serves(c, result))
                  ? ["(사용 중)"]
                  : []),
                ...(configurations.some((c) => c.label === "test" && serves(c, result))
                  ? ["(테스트)"]
                  : []),
              ];
              return (
                <tr
                  key={`${result.provider} ${result.model} ${String(result.promptVersionId)}`}
                  className={rowClass()}
                >
                  <td className={`${cellClass({ lead: true })} break-all`}>
                    {[
                      labelOf(providerLabels, result.provider),
                      result.model,
                      `v${String(result.promptVersionId)}`,
                    ].join(" · ")}
                    {marks.length === 0 ? "" : ` ${marks.join(" ")}`}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>호출</CellLabel>
                    {result.calls.toLocaleString("ko-KR")}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>카드 없음</CellLabel>
                    {result.noCards.toLocaleString("ko-KR")}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>형식 오류</CellLabel>
                    {result.invalidOutput.toLocaleString("ko-KR")}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>모델 오류</CellLabel>
                    {result.modelError.toLocaleString("ko-KR")}
                  </td>
                  <td className={`${cellClass({ numeric: true })} text-body-strong`}>
                    <CellLabel>실패율</CellLabel>
                    {result.failureRate === null ? "기록 없음" : <Rate rate={result.failureRate} />}
                  </td>
                </tr>
              );
            })}
          </AdminTable>
        )}
      </Section>
    </div>
  );
}

/**
 * One plan's panel: its draft against its active configuration, the lines its prompt changes,
 * collapsed, the trial, 테스트 끝내기 and 모두에게 적용, each asked first, then the form for a new
 * draft; without a draft, its active configuration and the same form.
 */
function Panel({
  plan,
  active,
  draft,
  versions,
  diff,
  timeZone,
}: {
  plan: PlanId;
  active: AiConfiguration | null;
  draft: AiConfiguration | null;
  versions: PromptVersion[];
  diff: { before: string; after: string } | null;
  timeZone: string;
}) {
  const name = planLabels[plan] ?? plan;
  const lines = diff === null ? null : lineDiff(diff.before, diff.after);
  const changed = lines?.filter((line) => line.kind !== "same").length ?? 0;
  const basis = draft ?? active;
  const usd = active === null ? null : usdPerPhoto(active.model);
  return (
    <Section
      label={draft === null ? `${name} · 사용 중인 구성` : `${name} · 초안 (관리자만 테스트 중)`}
    >
      <div className={group}>
        <div className={row}>
          <h3 className="text-headline break-all">
            {draft === null
              ? active === null
                ? "사용 중인 구성이 없어요"
                : describe(active)
              : changes(active, draft)}
          </h3>
          {draft !== null && active !== null && (
            <p className="text-caption text-muted break-all">지금 구성: {describe(active)}</p>
          )}
          {draft === null ? (
            <p className="text-caption text-muted">
              {usd === null ? "이 모델은 측정한 비용이 없어요." : `사진당 ${estimatedCost(1, usd)}`}
            </p>
          ) : (
            <p className="text-caption text-muted">
              관리자만 써요 · {formatTime(draft.createdAt, timeZone)}
              {draft.createdByEmail === null ? "" : ` · ${draft.createdByEmail}`}
            </p>
          )}
        </div>
        {lines !== null && draft !== null && active !== null && (
          <details className="px-4 py-3">
            <summary className="cursor-pointer text-label text-ink-2 focus-visible:outline-2 focus-visible:outline-ink">
              프롬프트 v{active.promptVersionId} → v{draft.promptVersionId} 다른 점
            </summary>
            {/* A details element does not lay its content out as flex items, so one block holds the gap. */}
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-caption text-muted">
                {changed === 0
                  ? "내용이 같아요."
                  : `바뀐 줄 ${String(changed)}개: 빼는 줄은 −, 더하는 줄은 +로 표시해요.`}
              </p>
              <ol className="flex flex-col rounded-group bg-ground p-3 font-mono text-caption">
                {lines.map((line, index) => (
                  <li
                    key={index}
                    className={`grid grid-cols-[1.5rem_1fr] whitespace-pre-wrap ${
                      line.kind === "removed"
                        ? "bg-tint-amber text-ink"
                        : line.kind === "added"
                          ? "bg-brand-tint text-ink"
                          : "text-ink-2"
                    }`}
                  >
                    <span aria-hidden>
                      {line.kind === "removed" ? "−" : line.kind === "added" ? "+" : ""}
                    </span>
                    <span>
                      <span className="sr-only">
                        {line.kind === "removed" ? "뺌: " : line.kind === "added" ? "더함: " : ""}
                      </span>
                      {line.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        )}
        {draft !== null && active !== null && (
          <AiTrial name={name} draftId={draft.id} activeId={active.id} />
        )}
        {draft !== null && (
          <div className="flex flex-wrap items-start gap-2 px-4 py-3">
            <ConfirmAction
              label="테스트 끝내기"
              question="테스트를 끝낼까요? 관리자도 지금 구성을 쓰게 돼요."
              confirmLabel="끝내기"
              action={clearAiTest.bind(null, plan)}
            />
            <ConfirmAction
              primary
              label="모두에게 적용"
              question={`${name} 사용자 모두에게 이 초안을 적용할까요?`}
              confirmLabel="적용"
              action={activateAiConfiguration.bind(null, plan)}
            />
          </div>
        )}
      </div>
      <h3 className="mt-3 px-1 text-section text-muted">새 초안</h3>
      <AiConfigurationForm
        key={plan}
        plan={plan}
        name={name}
        provider={basis?.provider ?? "openrouter"}
        model={basis?.model ?? ""}
        promptVersionId={basis?.promptVersionId ?? versions[0]?.id ?? 0}
        versions={versions.map((version) => version.id)}
      />
    </Section>
  );
}

/** 제공자 키: each provider's key by its last four characters, with its form and its removal. */
function ProviderKeys({
  keys,
  configurations,
  plan,
  editing,
  timeZone,
}: {
  keys: ProviderKey[];
  configurations: AiConfiguration[];
  plan: PlanId;
  editing: Provider | null;
  timeZone: string;
}) {
  return (
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
            <li key={entry.provider} className={`${row} gap-2`}>
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
              {editing === entry.provider ? (
                <>
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
                  <Link href={aiHref(plan)} className={button.row}>
                    닫기
                  </Link>
                </>
              ) : (
                <Link href={aiHref(plan, undefined, entry.provider)} className={button.row}>
                  {entry.key === null ? "키 저장" : "키 바꾸기"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** 프롬프트 버전: every version, newest first, each opening the form from it, and 새 버전 쓰기. */
function PromptVersions({
  versions,
  plan,
  timeZone,
}: {
  versions: PromptVersion[];
  plan: PlanId;
  timeZone: string;
}) {
  return (
    <Section label="프롬프트 버전" note="버전을 누르면 그 버전에서 새 버전을 써요.">
      {versions.length === 0 ? (
        <Empty>저장된 버전이 없어요. 새 버전을 써 보세요.</Empty>
      ) : (
        <ul aria-label="프롬프트 버전" className={`${group} overflow-hidden`}>
          {versions.map((version) => (
            <li key={version.id}>
              <Link href={aiHref(plan, version.id)} className={linkRow}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-strong">
                    {[
                      `v${String(version.id)}`,
                      ...labelWords(version),
                      formatDate(version.createdAt, timeZone),
                    ].join(" · ")}
                  </span>
                  {version.note !== "" && (
                    <span className="text-caption text-ink-2 break-all">{version.note}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={aiHref(plan, "active")} className={`${button.row} mt-1`}>
        새 버전 쓰기
      </Link>
    </Section>
  );
}
