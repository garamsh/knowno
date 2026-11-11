"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type CellDraft, type Span } from "../authoring";
import { type PastePart, splitPaste } from "../markdown-paste";
import { clozeAt, continueList, type Edit, hideSelection, removeCloze } from "../markup-editing";
import { hasFormatting, parse } from "@/design/markup-engine";
import { MarkupRuns, MarkupText } from "@/design/markup-text";
import { chip, type Draft, Field } from "./editor-field";

/** Whether a pointer is pressed anywhere on the page, read as a blur its press caused happens. */
export function usePressing() {
  const pressing = useRef(false);
  useEffect(() => {
    const down = () => {
      pressing.current = true;
    };
    const up = () => {
      pressing.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  return pressing;
}

/**
 * The text of [input] an edit leaves selected once the render that carries it is in: a controlled
 * textarea puts its caret at the end of a value it is given, so the selection is set after it.
 */
function useSelectAfter(input: RefObject<HTMLTextAreaElement | null>) {
  const [wanted, setWanted] = useState<Span | null>(null);
  useLayoutEffect(() => {
    if (wanted) input.current?.setSelectionRange(wanted.start, wanted.end);
  }, [wanted, input]);
  return (edit: Edit) => {
    setWanted({ start: edit.start, end: edit.end });
  };
}

/**
 * [text] as the engine reads it, drawn under its field while it holds a mark, a list, a line break
 * or a cloze, and nothing while it reads as written (the phone's `MarkupPreview`). A cloze is drawn
 * as study draws it, a blank on the tint with its hint, or its answer where it has none.
 */
export function MarkupPreview({ text, clozes = false }: { text: string; clozes?: boolean }) {
  const document = parse(text);
  if (!hasFormatting(document)) return null;
  return (
    <div role="group" aria-label="미리 보기" className="px-4 pb-2 text-body text-ink">
      <MarkupText
        document={document}
        cloze={
          clozes
            ? (span) => (
                <span
                  data-blank="preview"
                  className={`rounded-sm bg-brand-tint px-1 ${span.hint === null ? "" : "text-ink-2"}`}
                >
                  {span.hint ?? <MarkupRuns content={span.answer} />}
                </span>
              )
            : undefined
        }
      />
    </div>
  );
}

/** What a field does with a key and a paste, on top of typing, where its text is markup. */
function markupHandlers(
  value: string,
  select: (edit: Edit) => void,
  change: (value: string) => void,
  paste: (parts: PastePart[]) => void,
) {
  return {
    keyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (event.nativeEvent.isComposing) return;
      const { selectionStart, selectionEnd } = event.currentTarget;
      if (selectionStart !== selectionEnd) return;
      const edit = continueList(value, selectionStart);
      if (!edit) return;
      event.preventDefault();
      change(edit.text);
      select(edit);
    },
    paste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const parts = splitPaste(event.clipboardData.getData("text/plain"));
      if (!parts.some((part) => part.kind !== "text")) return;
      // A paste of a table or an image makes 칸 of its parts and takes nothing into the field.
      event.preventDefault();
      paste(parts);
    },
  };
}

/** A 글's "앞면" or "뒷면" as markup: a list goes on as a line is broken, and its formatting shows under it. */
export function MarkupField({
  label,
  value,
  change,
  paste,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  paste: (parts: PastePart[]) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const select = useSelectAfter(input);
  return (
    <div className="min-w-0 flex-1">
      <Field
        label={label}
        value={value}
        input={input}
        change={(next) => {
          change(next);
        }}
        {...markupHandlers(value, select, change, paste)}
      />
      <MarkupPreview text={value} />
    </div>
  );
}

/**
 * A 빈칸 문장 of version 2: its text in Anki's syntax, and under it, while it has focus, its one
 * action, "가리기", which wraps the selection in the next free cloze number, or, with the caret
 * in a cloze, "가리기 풀기", which gives its answer back; then the text as study draws it.
 */
export function AnkiGroup({
  draft,
  change,
  paste,
}: {
  draft: Draft<"anki">;
  change: (next: CellDraft) => void;
  paste: (parts: PastePart[]) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const select = useSelectAfter(input);
  const [selection, setSelection] = useState<Span>({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const pressing = usePressing();
  const set = (source: string) => {
    change({ ...draft, source });
  };
  const inside = clozeAt(draft.source, selection.start, selection.end);
  return (
    <div
      className="py-1"
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        const leave = () => {
          setFocused(false);
        };
        // A press elsewhere takes the focus as it starts; the action goes once it ends, so the
        // control pressed is not moved out from under it before its click.
        if (pressing.current) window.addEventListener("pointerup", leave, { once: true });
        else leave();
      }}
    >
      <div className="flex px-3">
        <Field
          label="문장"
          placeholder="가릴 부분을 고르고 가리기를 눌러요"
          lines={2}
          input={input}
          value={draft.source}
          change={(value, next) => {
            set(value);
            setSelection(next);
          }}
          select={setSelection}
          {...markupHandlers(draft.source, select, set, paste)}
        />
      </div>
      {focused && (
        <div className="px-4 pb-2">
          <button
            type="button"
            // Pressing keeps the field's focus and its selection.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              const edit = inside
                ? removeCloze(draft.source, inside)
                : hideSelection(draft.source, selection.start, selection.end);
              set(edit.text);
              setSelection({ start: edit.start, end: edit.end });
              select(edit);
              input.current?.focus();
            }}
            className={chip}
          >
            {inside ? "가리기 풀기" : "가리기"}
          </button>
        </div>
      )}
      <MarkupPreview text={draft.source} clozes />
    </div>
  );
}
