import Link from "next/link";

import { Section } from "@/design/section";

import { activatePrompt } from "../activate-prompt";
import { clearTestPrompt } from "../clear-test-prompt";
import { formatTime } from "../format";
import { countsLine, type ExtractionCall, type OutcomeSummary } from "../outcomes";
import { lineDiff } from "../prompt-diff";
import type { PromptDetail } from "../read-admin";
import { testPrompt } from "../test-prompt";
import { ConfirmAction } from "./confirm-action";
import { DailyRates, VersionCalls } from "./outcomes-view";
import { PromptChips } from "./prompt-chips";

/**
 * One version: the actions that serve it, each asked first, its 30 days' results by day, its
 * difference from the active version, its recorded calls a page at a time, and its text.
 */
export function PromptView({
  version,
  results,
  calls,
  before,
  more,
  timeZone,
}: {
  version: PromptDetail;
  /** This version's recorded calls over the last 30 UTC days. */
  results: OutcomeSummary;
  calls: ExtractionCall[];
  before: number | null;
  more: boolean;
  timeZone: string;
}) {
  const active = version.labels.includes("active");
  const test = version.labels.includes("test");
  const diff =
    version.active === null || active ? null : lineDiff(version.active.text, version.text);
  const changed = diff?.filter((line) => line.kind !== "same").length ?? 0;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="flex flex-wrap items-center gap-2 text-display">
          버전 {version.id}
          <PromptChips labels={version.labels} />
        </h1>
        <p className="text-caption text-muted">
          {version.note === "" ? "" : `${version.note} · `}
          {version.length.toLocaleString("ko-KR")}자 · {formatTime(version.createdAt, timeZone)}
          {version.createdByEmail === null ? "" : ` · ${version.createdByEmail}`}
        </p>
        <p className="text-caption text-ink-2">최근 30일 {countsLine(results.total)}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {!active && (
          <ConfirmAction
            label="모든 사용자에게 적용"
            question={`버전 ${String(version.id)}을 모든 사용자에게 적용할까요? 위에서 다른 점을 확인해 주세요.`}
            confirmLabel="적용"
            action={activatePrompt.bind(null, version.id)}
          />
        )}
        {!active && !test && (
          <ConfirmAction
            label="관리자만 테스트"
            question={`버전 ${String(version.id)}을 관리자에게만 쓸까요? 사용자는 지금 버전을 그대로 써요.`}
            confirmLabel="테스트 시작"
            action={testPrompt.bind(null, version.id)}
          />
        )}
        {test && (
          <ConfirmAction
            label="테스트 끝내기"
            question="테스트를 끝낼까요? 관리자도 사용 중인 버전을 쓰게 돼요."
            confirmLabel="테스트 끝내기"
            action={clearTestPrompt}
          />
        )}
      </div>
      <DailyRates days={results.days} />
      {diff !== null && version.active !== null && (
        <Section
          label={`사용 중인 버전 ${String(version.active.id)}과 다른 점`}
          note={
            changed === 0
              ? "내용이 같아요."
              : `바뀐 줄 ${String(changed)}개: 빼는 줄은 −, 더하는 줄은 +로 표시해요.`
          }
        >
          <ol className="flex flex-col rounded-group bg-surface p-3 font-mono text-caption">
            {diff.map((line, index) => (
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
        </Section>
      )}
      <VersionCalls
        versionId={version.id}
        calls={calls}
        before={before}
        more={more}
        timeZone={timeZone}
      />
      <Section label="프롬프트">
        <Link
          href={`/ai/new?from=${String(version.id)}`}
          className="self-start px-1 text-body text-ink-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
        >
          이 버전에서 새 버전 쓰기
        </Link>
        <pre className="rounded-group bg-surface p-4 font-mono text-caption whitespace-pre-wrap">
          {version.text}
        </pre>
      </Section>
    </>
  );
}
