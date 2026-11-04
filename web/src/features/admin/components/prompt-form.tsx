"use client";

import { useActionState, useState } from "react";

import { Section } from "@/design/section";

import { maxNoteLength, maxPromptLength } from "../prompt-limits";
import type { SavePromptState } from "../save-prompt";
import { button, field, group } from "./admin-section";

/**
 * The form that saves a new version through [save], starting from [initialText], under [note].
 * Saving serves it to no one; a plan's draft then names it, and is tried and applied. 모두에게
 * 적용 is the page's one primary, so its button is outlined.
 */
export function PromptForm({
  initialText,
  note,
  save,
}: {
  initialText: string;
  note: string;
  save: (previous: SavePromptState, form: FormData) => Promise<SavePromptState>;
}) {
  const [state, action, pending] = useActionState<SavePromptState, FormData>(save, {
    message: null,
  });
  const [length, setLength] = useState(initialText.length);
  return (
    <Section label="새 버전" note={note}>
      <form action={action} aria-label="새 버전" className="flex flex-col gap-2">
        <div className={group}>
          <label className="flex flex-col gap-2 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-body">프롬프트</span>
              <span aria-hidden className="text-caption text-muted tabular-nums">
                {length.toLocaleString("ko-KR")} / {maxPromptLength.toLocaleString("ko-KR")}자
              </span>
            </span>
            <textarea
              name="text"
              defaultValue={initialText}
              required
              maxLength={maxPromptLength}
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
          저장
        </button>
        <p role="status" className="text-caption text-muted empty:hidden">
          {state.message}
        </p>
      </form>
    </Section>
  );
}
