"use client";

import { useActionState, useState } from "react";

import { Section } from "@/design/section";

import { maxNoteLength } from "../prompt-limits";
import type { SaveSkillState } from "../save-card-form-skill";
import { maxSkillLength, maxSummaryLength } from "../skill-limits";
import { button, field, group } from "./admin-section";

/**
 * The form that saves a new version of a card form's skill through [save], starting from [summary]
 * and [text], under [note]. Saving makes it the form's draft, tried by admins; 모두에게 적용 is the
 * panel's one primary, so its button is outlined.
 */
export function SkillForm({
  name,
  summary,
  text,
  note,
  save,
}: {
  name: string;
  summary: string;
  text: string;
  note: string;
  save: (previous: SaveSkillState, form: FormData) => Promise<SaveSkillState>;
}) {
  const [state, action, pending] = useActionState<SaveSkillState, FormData>(save, {
    message: null,
  });
  const [length, setLength] = useState(text.length);
  return (
    <Section label="새 버전" note={note}>
      <form action={action} aria-label={`${name} 새 버전`} className="flex flex-col gap-2">
        <div className={group}>
          <label className="flex min-h-button items-center gap-3 px-4">
            <span className="shrink-0 text-body">한 줄 요약</span>
            <input
              name="summary"
              defaultValue={summary}
              required
              maxLength={maxSummaryLength}
              className={`${field} h-tap-target flex-1 px-2`}
            />
          </label>
          <label className="flex flex-col gap-2 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-body">가이드</span>
              <span aria-hidden className="text-caption text-muted tabular-nums">
                {length.toLocaleString("ko-KR")} / {maxSkillLength.toLocaleString("ko-KR")}자
              </span>
            </span>
            <textarea
              name="text"
              defaultValue={text}
              required
              maxLength={maxSkillLength}
              rows={16}
              onChange={(event) => {
                setLength(event.target.value.length);
              }}
              className={`${field} bg-ground p-3 font-mono text-caption`}
            />
          </label>
          <label className="flex min-h-button items-center gap-3 px-4">
            <span className="shrink-0 text-body">메모</span>
            <input
              name="note"
              maxLength={maxNoteLength}
              className={`${field} h-tap-target flex-1 px-2`}
            />
          </label>
        </div>
        <button type="submit" disabled={pending} className={button.secondary}>
          초안으로 저장
        </button>
        <p role="status" className="text-caption text-muted empty:hidden">
          {state.message}
        </p>
      </form>
    </Section>
  );
}
