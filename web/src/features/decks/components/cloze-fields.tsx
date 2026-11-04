"use client";

import { useEffect, useRef, useState } from "react";
import { type CellDraft, movedSpans, type Span, spanAt, withSpan } from "../authoring";
import { chip, type Draft, Field } from "./editor-field";

/** Whether a pointer is pressed anywhere on the page, read as a blur its press caused happens. */
function usePressing() {
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
 * A 빈칸 문장's line: its one action sits under it while it has focus, "빈칸 넣기", or "빈칸 풀기" with
 * the caret in a blank. A blank opened with nothing selected takes what is typed until the caret
 * leaves it, and goes if it stays empty.
 */
export function ClozeGroup({
  draft,
  change,
}: {
  draft: Draft<"cloze">;
  change: (next: CellDraft) => void;
}) {
  const [selection, setSelection] = useState<Span>({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const line = useRef<HTMLTextAreaElement>(null);
  const pressing = usePressing();
  const inside = spanAt(draft.blanks, selection);
  const answer = inside ? draft.line.slice(inside.start, inside.end) : "";
  function leaveOpen() {
    setOpen(null);
    change({ ...draft, blanks: draft.blanks.filter(({ start, end }) => start < end) });
  }
  return (
    <div
      className="px-3 py-1"
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        const leave = () => {
          setFocused(false);
          if (open !== null) leaveOpen();
        };
        // A press elsewhere takes the focus as it starts; the action goes once it ends, so the
        // control pressed is not moved out from under it before its click.
        if (pressing.current) window.addEventListener("pointerup", leave, { once: true });
        else leave();
      }}
    >
      <Field
        label="문장"
        placeholder="문장 속 단어를 가려요"
        lines={2}
        input={line}
        value={draft.line}
        marks={draft.blanks}
        change={(value, next) => {
          change({
            ...draft,
            line: value,
            blanks: movedSpans(draft.line, value, draft.blanks, open),
          });
          setSelection(next);
        }}
        select={(next) => {
          setSelection(next);
          const blank = draft.blanks.find(({ start }) => start === open);
          if (open !== null && !(blank && spanAt([blank], next))) leaveOpen();
        }}
      />
      {focused && (
        <div className="pb-2">
          <button
            type="button"
            aria-label={inside ? `빈칸 풀기, ${answer || "빈칸"}` : "빈칸 넣기"}
            // Pressing keeps the line's focus and its selection.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (inside) {
                setOpen(null);
                change({ ...draft, blanks: draft.blanks.filter((blank) => blank !== inside) });
              } else {
                if (selection.start === selection.end) setOpen(selection.start);
                change({ ...draft, blanks: withSpan(draft.blanks, selection) });
              }
              line.current?.focus();
            }}
            className={chip}
          >
            {inside ? "빈칸 풀기" : "빈칸 넣기"}
          </button>
        </div>
      )}
    </div>
  );
}
