import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { activateCardFormSkill } from "../activate-card-form-skill";
import { clearCardFormSkillTest } from "../clear-card-form-skill-test";
import { formatDate, formatTime } from "../format";
import { type CardForm, cardFormLabels, cardForms } from "../labels";
import type { SkillVersion } from "../read-admin";
import { saveCardFormSkill } from "../save-card-form-skill";
import { Empty, group, linkRow, row } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { PromptChanges } from "./prompt-changes";
import { SkillForm } from "./skill-form";

/** The version of [form] that carries [label]: the draft's or the active one, null for none. */
function labelled(skills: SkillVersion[], form: CardForm, label: "active" | "test") {
  return skills.find((skill) => skill.form === form && skill.labels.includes(label)) ?? null;
}

/**
 * 카드 형식 스킬 (ADR 0197, ADR 0212): each card form with the version everyone is served and, while
 * one is set, the draft admins are served, each opening the form's panel at [href].
 */
export function SkillList({
  skills,
  href,
}: {
  skills: SkillVersion[];
  href: (form: CardForm) => string;
}) {
  return (
    <Section
      label="카드 형식 스킬"
      note="말랑이와 MCP가 형식마다 읽는 가이드예요. 형식을 누르면 초안을 고쳐 써요."
    >
      <ul aria-label="카드 형식 스킬" className={`${group} overflow-hidden`}>
        {cardForms.map((form) => {
          const active = labelled(skills, form, "active");
          const draft = labelled(skills, form, "test");
          return (
            <li key={form}>
              <Link href={href(form)} className={linkRow}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-strong">
                    {[
                      cardFormLabels[form],
                      active === null ? "사용 중인 버전 없음" : `v${String(active.id)} 사용 중`,
                    ].join(" · ")}
                  </span>
                  {active !== null && (
                    <span className="text-caption text-ink-2 break-words">{active.summary}</span>
                  )}
                </span>
                {draft !== null && <Chip>{`v${String(draft.id)} 테스트 중`}</Chip>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * One form's panel: its draft against the version in use, the summary and the lines its guide
 * changes, collapsed, 테스트 끝내기 and 모두에게 적용, each asked first, then the form for a new
 * version, from [from], else the draft, else the version in use, and the form's versions, each
 * opening the form from it at [fromHref].
 */
export function SkillPanel({
  form,
  skills,
  from,
  fromHref,
  timeZone,
}: {
  form: CardForm;
  skills: SkillVersion[];
  from: SkillVersion | null;
  fromHref: (id: number) => string;
  timeZone: string;
}) {
  const name = cardFormLabels[form];
  const active = labelled(skills, form, "active");
  const draft = labelled(skills, form, "test");
  const start = from ?? draft ?? active;
  const versions = skills.filter((skill) => skill.form === form);
  return (
    <Section
      label={draft === null ? `${name} · 사용 중인 스킬` : `${name} · 초안 (관리자만 테스트 중)`}
    >
      <div className={group}>
        <div className={row}>
          <h3 className="text-headline break-words">
            {(draft ?? active)?.summary ?? "사용 중인 스킬이 없어요"}
          </h3>
          {draft !== null && active !== null && (
            <p className="text-caption text-muted break-words">
              지금 사용 중: v{active.id} · {active.summary}
            </p>
          )}
          {draft !== null && (
            <p className="text-caption text-muted">
              v{draft.id} · 관리자만 써요 · {formatTime(draft.createdAt, timeZone)}
              {draft.createdByEmail === null ? "" : ` · ${draft.createdByEmail}`}
            </p>
          )}
        </div>
        {draft !== null && active !== null && active.id !== draft.id && (
          <PromptChanges
            subject={`${name} 스킬`}
            from={active.id}
            to={draft.id}
            before={`${active.summary}\n${active.text}`}
            after={`${draft.summary}\n${draft.text}`}
          />
        )}
        {draft !== null && (
          <div className="flex flex-wrap items-start gap-2 px-4 py-3">
            <ConfirmAction
              label="테스트 끝내기"
              question="테스트를 끝낼까요? 관리자도 사용 중인 스킬을 쓰게 돼요."
              confirmLabel="끝내기"
              action={clearCardFormSkillTest.bind(null, form)}
            />
            <ConfirmAction
              primary
              label="모두에게 적용"
              question={`${name} 스킬의 이 초안을 모두에게 적용할까요?`}
              confirmLabel="적용"
              action={activateCardFormSkill.bind(null, form)}
            />
          </div>
        )}
      </div>
      <SkillForm
        key={`${form}-${String(start?.id ?? 0)}`}
        name={name}
        summary={start?.summary ?? ""}
        text={start?.text ?? ""}
        note={
          start === null
            ? "빈 스킬에서 시작해요."
            : `버전 ${String(start.id)}에서 시작해요. 저장하면 초안이 되어 관리자만 말랑이와 MCP에서 써 볼 수 있어요.`
        }
        save={saveCardFormSkill.bind(null, form)}
      />
      <h3 className="mt-3 px-1 text-section text-muted">{name} 스킬 버전</h3>
      {versions.length === 0 ? (
        <Empty>저장된 버전이 없어요.</Empty>
      ) : (
        <ul aria-label={`${name} 스킬 버전`} className={`${group} overflow-hidden`}>
          {versions.map((version) => (
            <li key={version.id}>
              <Link href={fromHref(version.id)} className={linkRow}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-strong">
                    {[
                      `v${String(version.id)}`,
                      ...(version.labels.includes("active") ? ["사용 중"] : []),
                      ...(version.labels.includes("test") ? ["초안"] : []),
                      formatDate(version.createdAt, timeZone),
                    ].join(" · ")}
                  </span>
                  {version.note !== "" && (
                    <span className="text-caption text-ink-2 break-words">{version.note}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
