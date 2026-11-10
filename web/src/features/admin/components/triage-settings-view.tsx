import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { activateTriageConfiguration } from "../activate-triage-configuration";
import { clearTriageTest } from "../clear-triage-test";
import { formatTime, usd } from "../format";
import { labelOf, providerLabels, triageCategoryLabels, triageModeLabels } from "../labels";
import { resumeTriage } from "../resume-triage";
import type { Agreement, TriageConfiguration, TriageSettings } from "../read-triage";
import { setTriageMode } from "../set-triage-mode";
import { parseTriageMode } from "../triage-input";
import { Empty, Facts, group, row } from "./admin-section";
import { AdminTable, CellLabel, cellClass, rowClass } from "./admin-table";
import { ConfirmAction } from "./confirm-action";
import { TriageConfigurationForm } from "./triage-configuration-form";
import { TriageSettingsForm } from "./triage-settings-form";
import { percent } from "./triage-verdict";

const agreementHead = [
  { label: "AI의 판단" },
  { label: "비교한 수", align: "end" },
  { label: "관리자와 같았던 수", align: "end" },
  { label: "일치율", align: "end" },
] as const;

const defaults = {
  cheap: { provider: "openrouter", model: "", inUsd: 0, outUsd: 0 },
  strong: { provider: "openrouter", model: "", inUsd: 0, outUsd: 0 },
  prompt: "",
  escalateBelow: 0.7,
  payloadTokens: 3000,
  sampleCards: 5,
};

/** A tier in words: "OpenRouter · <model> · 입력 $0.1 · 출력 $0.4 (백만 토큰당)". */
function tierWords(tier: TriageConfiguration["cheap"]): string {
  return `${labelOf(providerLabels, tier.provider)} · ${tier.model} · 입력 $${String(tier.inUsd)} · 출력 $${String(tier.outUsd)} (백만 토큰당)`;
}

/** One labelled configuration: its tiers and limits, who set it and when. */
function Configuration({
  configuration,
  timeZone,
  children,
}: {
  configuration: TriageConfiguration;
  timeZone: string;
  children?: React.ReactNode;
}) {
  return (
    <Section
      label={configuration.label === "test" ? "초안 (관리자만 테스트 중)" : "사용 중인 구성"}
    >
      <Facts
        facts={[
          ["먼저 보는 모델", tierWords(configuration.cheap)],
          ["다시 보는 모델", tierWords(configuration.strong)],
          ["다시 보는 확신 기준", String(configuration.escalateBelow)],
          ["글 길이", `${configuration.payloadTokens.toLocaleString("ko-KR")}토큰`],
          ["살펴볼 카드", `${String(configuration.sampleCards)}장`],
          [
            "저장",
            `${formatTime(configuration.setAt, timeZone)}${
              configuration.setByEmail === null ? "" : ` · ${configuration.setByEmail}`
            }`,
          ],
        ]}
      />
      {children}
    </Section>
  );
}

/**
 * 신고 AI 설정: its mode, shown as judge-only until an admin switches it; its use today and the
 * undo rate; the threshold and caps; how often its verdicts agreed with an admin's decisions; and
 * its configuration, the active one and the draft (ADR 0244).
 */
export function TriageSettingsView({
  settings,
  agreement,
  configurations,
  timeZone,
}: {
  settings: TriageSettings;
  agreement: Agreement[];
  configurations: TriageConfiguration[];
  timeZone: string;
}) {
  // Whatever the server holds, only exactly `acting` is shown as acting.
  const mode = parseTriageMode(settings.mode);
  const active = configurations.find((configuration) => configuration.label === "active");
  const draft = configurations.find((configuration) => configuration.label === "test");
  const start = draft ?? active;
  return (
    <div className="flex flex-col gap-section-gap">
      <Section
        label="처리 방식"
        note="처음에는 AI가 판단만 하고 아무것도 바꾸지 않아요. 직접 처리하기를 켜야 숨기거나 신고를 정리해요."
      >
        <div className={group}>
          <div className={row}>
            <p className="text-headline" aria-label="현재 처리 방식">
              {labelOf(triageModeLabels, mode)}
            </p>
            {settings.pausedAt !== null && (
              <p className="text-body text-ink-2">
                <Chip tone="amber">멈춤</Chip>{" "}
                {settings.pausedReason === "undo_rate"
                  ? "되돌린 비율이 기준을 넘어 AI가 직접 처리하는 것을 멈췄어요."
                  : "AI가 직접 처리하는 것을 멈췄어요."}{" "}
                {formatTime(settings.pausedAt, timeZone)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-start gap-2 px-4 py-3">
            {mode === "judge_only" ? (
              <ConfirmAction
                label="직접 처리하기로 바꾸기"
                question={`AI가 확신 ${percent(settings.actThreshold)} 이상인 노트를 직접 숨기거나 신고를 정리하게 할까요? 처리한 것은 모두 되돌릴 수 있어요.`}
                confirmLabel="직접 처리하기"
                action={setTriageMode.bind(null, "acting")}
              />
            ) : (
              <ConfirmAction
                label="판단만 하기로 바꾸기"
                question="AI가 판단만 하고 아무것도 바꾸지 않게 할까요?"
                confirmLabel="판단만 하기"
                action={setTriageMode.bind(null, "judge_only")}
              />
            )}
            {settings.pausedAt !== null && (
              <ConfirmAction
                label="다시 켜기"
                question="멈춘 것을 풀까요? 지금부터 되돌린 비율을 새로 세요."
                confirmLabel="다시 켜기"
                action={resumeTriage}
              />
            )}
          </div>
        </div>
      </Section>
      <Section label="오늘 쓴 것" note="비용과 판단 수는 UTC 날짜 기준으로 세요.">
        <Facts
          facts={[
            ["비용", `${usd(settings.spentTodayUsd)} / ${usd(settings.dailyCapUsd)}`],
            [
              "판단한 노트",
              `${settings.judgedToday.toLocaleString("ko-KR")} / ${settings.dailyNotes.toLocaleString("ko-KR")}`,
            ],
            [
              `최근 ${String(settings.undoWindowHours)}시간 처리`,
              `${settings.actionsInWindow.toLocaleString("ko-KR")}건`,
            ],
            [
              "되돌린 비율",
              settings.undoRate === null ? "없음" : percent(settings.undoRate),
              `${percent(settings.undoThreshold)}를 넘으면 ${String(settings.undoMinActions)}건 이상일 때 멈춰요`,
            ],
          ]}
        />
      </Section>
      <Section label="기준과 한도">
        <TriageSettingsForm
          start={{
            actThreshold: settings.actThreshold,
            dailyCapUsd: settings.dailyCapUsd,
            dailyNotes: settings.dailyNotes,
            samplePercent: settings.samplePercent,
            reporterDailyCap: settings.reporterDailyCap,
          }}
        />
      </Section>
      <Section
        label="관리자와의 일치율"
        note="AI의 판단 뒤에 관리자가 같은 노트에 처음 내린 결정과 비교해요. 기타와 판단하지 못함은 빼요."
      >
        {agreement.length === 0 ? (
          <Empty>아직 비교한 것이 없어요.</Empty>
        ) : (
          <AdminTable label="관리자와의 일치율" head={agreementHead}>
            {agreement.map((line) => (
              <tr key={line.category} className={rowClass()}>
                <td className={cellClass({ lead: true })}>
                  {labelOf(triageCategoryLabels, line.category)}
                </td>
                <td className={cellClass({ align: "end" })}>
                  <CellLabel>비교한 수</CellLabel>
                  {line.compared.toLocaleString("ko-KR")}
                </td>
                <td className={cellClass({ align: "end" })}>
                  <CellLabel>같았던 수</CellLabel>
                  {line.agreed.toLocaleString("ko-KR")}
                </td>
                <td className={cellClass({ align: "end" })}>
                  <CellLabel>일치율</CellLabel>
                  {line.compared === 0 ? "없음" : percent(line.agreed / line.compared)}
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
      </Section>
      {active === undefined && draft === undefined && (
        <Section label="구성">
          <Empty>
            저장된 구성이 없어요. 아래에서 초안을 저장하면 관리자만 먼저 써 볼 수 있어요.
          </Empty>
        </Section>
      )}
      {active !== undefined && <Configuration configuration={active} timeZone={timeZone} />}
      {draft !== undefined && (
        <Configuration configuration={draft} timeZone={timeZone}>
          <div className="flex flex-wrap items-start gap-2">
            <ConfirmAction
              label="테스트 끝내기"
              question="테스트를 끝낼까요? 초안은 쓰이지 않아요."
              confirmLabel="끝내기"
              action={clearTriageTest}
            />
            <ConfirmAction
              primary
              label="적용"
              question="이 초안을 신고 AI에 적용할까요? 다음 노트부터 이 구성으로 판단해요."
              confirmLabel="적용"
              action={activateTriageConfiguration}
            />
          </div>
        </Configuration>
      )}
      <Section
        label="새 초안"
        note="저장하기 전에 두 모델에 한 번씩 물어 형식을 확인해요. 저장해도 적용하기 전에는 쓰이지 않아요."
      >
        <TriageConfigurationForm
          start={
            start === undefined
              ? defaults
              : {
                  cheap: start.cheap,
                  strong: start.strong,
                  prompt: start.prompt,
                  escalateBelow: start.escalateBelow,
                  payloadTokens: start.payloadTokens,
                  sampleCards: start.sampleCards,
                }
          }
        />
      </Section>
    </div>
  );
}
