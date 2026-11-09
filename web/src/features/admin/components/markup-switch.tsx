import { Section } from "@/design/section";

import { formatTime } from "../format";
import type { CardMarkup } from "../read-admin";
import { setCardMarkup } from "../set-card-markup";
import { group, row } from "./admin-section";
import { ConfirmAction } from "./confirm-action";

/**
 * 카드 마크업 (ADR 0216): whether the server writes the card text markup and Anki's cloze, who set
 * it and when, and the control that turns it on or off, asked first. The page cannot check the
 * condition for turning it on, so it states it.
 */
export function MarkupSwitch({ markup, timeZone }: { markup: CardMarkup; timeZone: string }) {
  const next = !markup.enabled;
  return (
    <Section
      label="카드 마크업"
      note="켜면 말랑이와 MCP가 글 카드에 굵게·목록 같은 서식을, 빈칸 카드에 Anki 문법을 써요. 서식을 읽는 앱이 TestFlight에 올라온 뒤에 켜세요."
    >
      <div className={group}>
        <div className={row}>
          <p className="text-body-strong">{markup.enabled ? "켜짐" : "꺼짐"}</p>
          <p className="text-caption text-muted">
            {markup.setByEmail === null
              ? "아직 바꾼 적 없어요"
              : `${formatTime(markup.setAt, timeZone)} · ${markup.setByEmail}`}
          </p>
          <p className="text-caption text-muted break-words">
            켜기 전에: 글 버전 3과 빈칸 버전 2를 읽는 앱이 TestFlight에 있어야 해요. 이 페이지는
            확인할 수 없어요.
          </p>
        </div>
        <div className="px-4 py-3">
          <ConfirmAction
            label={next ? "마크업 켜기" : "마크업 끄기"}
            question={
              next
                ? "마크업을 켤까요? 글 버전 3과 빈칸 버전 2를 읽는 앱이 TestFlight에 있어야 해요."
                : "마크업을 끌까요? 새 카드는 예전 형식으로 쓰고, 이미 쓴 카드는 그대로예요."
            }
            confirmLabel={next ? "켜기" : "끄기"}
            action={setCardMarkup.bind(null, next)}
          />
        </div>
      </div>
    </Section>
  );
}
