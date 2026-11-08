"use client";

import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { CellDraft, Span } from "../authoring";

/** The draft of a 칸 of kind [K]. */
export type Draft<K extends CellDraft["kind"]> = Extract<CellDraft, { kind: K }>;

/** A field's box, padded as the phone's `AppTextField`: 16 across, and down the field's height past a line. */
const fieldBox = "whitespace-pre-wrap break-words field-padding text-body";
/** A field's least height: one line, or two as the phone's 빈칸 문장 line. */
const fieldHeight = {
  1: "min-h-field",
  2: "min-h-[calc(var(--spacing-field)+var(--text-body--line-height))]",
} as const;
/** A table cell's box, padded 12 on every side as the phone's table pads a cell's field. */
const cellBox = "whitespace-pre-wrap break-words p-3 text-body";
/** A small outlined control, its target the tap target's height past what it draws. */
const chipShape =
  "pressable relative h-8 min-w-tap-target rounded-chip border px-3 text-secondary before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] disabled:opacity-40";
/** A chip's classes while it is off: outlined on the surface. */
export const chip = `${chipShape} border-outline bg-surface`;
/** A chip's classes while it is on: an ink outline on the brand tint. */
export const chipOn = `${chipShape} border-ink bg-brand-tint`;

/**
 * A field that grows with its text and tints each of [marks] in it as a blank, as the phone's line
 * draws its blanks: the text sits in a textarea over a copy that draws the tint. An empty blank,
 * the mark of no width, is a short underline where the caret stands, which moves no text. A table's
 * [shape] "cell" takes the cell's padding in place of the field's; a field is [lines] tall at least.
 */
export function Field({
  label,
  value,
  change,
  marks = [],
  placeholder,
  select,
  input,
  keyDown,
  paste,
  shape = "field",
  lines = 1,
}: {
  shape?: "field" | "cell";
  lines?: 1 | 2;
  label: string;
  value: string;
  change: (value: string, selection: Span) => void;
  marks?: Span[];
  placeholder?: string;
  select?: (selection: Span) => void;
  input?: React.Ref<HTMLTextAreaElement>;
  keyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  paste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const read = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    select?.({ start, end });
  };
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of [...marks].sort((a, b) => a.start - b.start)) {
    parts.push(value.slice(at, start));
    parts.push(
      start === end ? (
        <span key={start} className="relative">
          <span className="absolute bottom-0 left-0 h-px w-8 bg-muted" />
        </span>
      ) : (
        <span key={start} className="rounded-md bg-brand-tint">
          {value.slice(start, end)}
        </span>
      ),
    );
    at = end;
  }
  parts.push(value.slice(at));
  const box = shape === "cell" ? cellBox : `${fieldBox} ${fieldHeight[lines]}`;
  return (
    <div className="relative min-w-0 flex-1">
      <div aria-hidden className={`${box} text-transparent`}>
        {parts}
        {"​"}
      </div>
      <textarea
        ref={input}
        aria-label={label}
        value={value}
        rows={1}
        placeholder={placeholder}
        onChange={(event) => {
          const { selectionStart: start, selectionEnd: end } = event.target;
          change(event.target.value, { start, end });
        }}
        onFocus={read}
        onSelect={read}
        onKeyDown={keyDown}
        onPaste={paste}
        className={`absolute inset-0 size-full resize-none overflow-hidden rounded-field bg-transparent ${box} placeholder:text-muted focus:outline-2 focus:-outline-offset-2 focus:outline-ink`}
      />
    </div>
  );
}

/** A 칸's problem, in words under its fields. */
export function Problem({ children }: { children: string }) {
  return (
    <p role="alert" className="px-4 pb-3 text-caption text-dont-know-text">
      {children}
    </p>
  );
}

/** Two chips of which one holds, in a row named by [label], or by the chips alone. */
export function Choices<V extends string>({
  label,
  name,
  choices,
  value,
  change,
}: {
  label?: string;
  name: string;
  choices: [V, string][];
  value: V;
  change: (value: V) => void;
}) {
  return (
    <div role="group" aria-label={name} className="flex items-center gap-2 px-4 py-2">
      {label && <span className="flex-1 text-secondary text-muted">{label}</span>}
      {choices.map(([choice, text]) => (
        <button
          key={choice}
          type="button"
          aria-pressed={value === choice}
          onClick={() => {
            change(choice);
          }}
          className={value === choice ? chipOn : chip}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
