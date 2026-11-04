import Link from "next/link";

import { activatePrompt } from "../activate-prompt";
import { countsLine, failureAlarm, failureRate, type OutcomeCounts, percent } from "../outcomes";
import type { PromptVersion } from "../read-admin";
import { Section } from "@/design/section";
import { button, card, Empty, group, linkRow } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { PromptChips } from "./prompt-chips";
import { PromptTrial } from "./prompt-trial";

const none: OutcomeCounts = {
  calls: 0,
  ok: 0,
  noCards: 0,
  invalidOutput: 0,
  modelError: 0,
  retried: 0,
  recovered: 0,
  unrecorded: 0,
};

/** [counts]' failure rate in words, or what is true without a recorded call. */
function rateWords(counts: OutcomeCounts): string {
  const rate = failureRate(counts);
  return rate === null ? "기록 없음" : percent(rate);
}

/**
 * 사진 AI: the active prompt with its week's failure rate and 새 버전 쓰기, the version under test
 * with its rate and 모두에게 적용, the trial on one photo, then each version's 30-day results, each
 * opening the version.
 */
export function AiView({
  versions,
  week,
  month,
}: {
  versions: PromptVersion[];
  /** Each version's recorded calls over the last 7 UTC days. */
  week: ReadonlyMap<number, OutcomeCounts>;
  /** Each version's recorded calls over the last 30 UTC days. */
  month: ReadonlyMap<number, OutcomeCounts>;
}) {
  const active = versions.find((version) => version.labels.includes("active"));
  const test = versions.find((version) => version.labels.includes("test"));
  const served = test ?? active;
  return (
    <div className="flex flex-col gap-section-gap">
      <div className="grid gap-4 md:grid-cols-3">
        <section aria-label="사용 중 프롬프트" className={card}>
          <h2 className="text-body-strong text-ink-2">사용 중 프롬프트</h2>
          <p className="text-figure tabular-nums">
            {active === undefined ? "없음" : `버전 ${String(active.id)}`}
          </p>
          <p className="text-caption text-ink-2">
            {active === undefined
              ? "모든 사용자에게 쓰는 버전이 없어요."
              : `실패율 ${rateWords(week.get(active.id) ?? none)} · 최근 7일`}
          </p>
          <Link href="/ai/new" className={`${button.row} mt-2 self-start`}>
            새 버전 쓰기
          </Link>
        </section>
        <section aria-label="테스트 중" className={card}>
          <h2 className="text-body-strong text-ink-2">테스트 중</h2>
          <p className="text-figure tabular-nums">
            {test === undefined ? "없음" : `버전 ${String(test.id)}`}
          </p>
          {test === undefined ? (
            <p className="text-caption text-ink-2">
              관리자만 쓰는 버전이 없어요. 버전을 열어 테스트를 시작해요.
            </p>
          ) : (
            <>
              <p className="text-caption text-ink-2">
                실패율 {rateWords(month.get(test.id) ?? none)} · 관리자{" "}
                {(month.get(test.id) ?? none).calls.toLocaleString("ko-KR")}회
              </p>
              <div className="mt-2">
                <ConfirmAction
                  compact
                  label="모두에게 적용"
                  question={`버전 ${String(test.id)}을 모든 사용자에게 적용할까요? 버전 화면에서 다른 점을 확인할 수 있어요.`}
                  confirmLabel="적용"
                  action={activatePrompt.bind(null, test.id)}
                />
              </div>
            </>
          )}
        </section>
        {served !== undefined && <PromptTrial served={{ id: served.id, test: served === test }} />}
      </div>
      <Section label="버전별 결과" note="최근 30일, UTC 날짜 기준이에요">
        {versions.length === 0 ? (
          <Empty>저장된 버전이 없어요. 새 버전을 써 보세요.</Empty>
        ) : (
          <ul className={`${group} overflow-hidden`}>
            {versions.map((version) => {
              const counts = month.get(version.id) ?? none;
              const rate = failureRate(counts);
              return (
                <li key={version.id}>
                  <Link href={`/ai/${String(version.id)}`} className={linkRow}>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body-strong">버전 {version.id}</span>
                        <PromptChips labels={version.labels} />
                        {version.note !== "" && (
                          <span className="text-body text-ink-2">{version.note}</span>
                        )}
                      </span>
                      <span className="text-caption text-ink-2">{countsLine(counts)}</span>
                    </span>
                    <span
                      className={`text-body-strong whitespace-nowrap tabular-nums ${
                        rate !== null && rate > failureAlarm ? "text-dont-know-text" : ""
                      }`}
                    >
                      {rateWords(counts)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
