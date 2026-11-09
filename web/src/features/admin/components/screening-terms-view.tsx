import { Section } from "@/design/section";

import { formatDate } from "../format";
import type { ScreeningTerm } from "../read-screening";
import { importScreeningWords, removeScreeningTerm } from "../screening-terms";
import { screeningWords } from "../screening-words";
import { Empty, group } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { ScreeningTermForm } from "./screening-term-form";

/**
 * 금칙어: the form to add a word, the import of the bundled list, and the words, each with 삭제.
 * A note whose text holds one of them is refused when its owner publishes it.
 */
export function ScreeningTermsView({
  terms,
  timeZone,
}: {
  terms: ScreeningTerm[];
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-section-gap">
      <ScreeningTermForm />
      <Section
        label="기본 목록 불러오기"
        note={`공개된 한국어 금칙어 목록(MIT 라이선스)에서 분명한 욕설 ${String(screeningWords.length)}개를 골랐어요. 이미 있는 단어는 건너뛰어요.`}
      >
        <ConfirmAction
          label="기본 목록 불러오기"
          question="기본 금칙어 목록을 불러올까요? 이미 있는 단어는 건너뛰어요."
          confirmLabel="불러오기"
          action={importScreeningWords}
        />
      </Section>
      <Section label="금칙어" note={`${String(terms.length)}개`}>
        {terms.length === 0 ? (
          <Empty>금칙어가 없어요. 단어를 추가하거나 기본 목록을 불러오세요.</Empty>
        ) : (
          <ul aria-label="금칙어 목록" className={group}>
            {terms.map((term) => (
              <li
                key={term.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-body-strong break-all">{term.term}</span>
                  <span className="text-caption text-ink-2">
                    {formatDate(term.createdAt, timeZone)}
                  </span>
                </span>
                <ConfirmAction
                  compact
                  label={`'${term.term}' 삭제`}
                  question={`'${term.term}'을(를) 금칙어에서 지울까요?`}
                  confirmLabel="삭제"
                  action={removeScreeningTerm.bind(null, term.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
