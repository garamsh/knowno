"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  blankPressed,
  type CellDraft,
  cellProblem,
  emptySense,
  type MediaFile,
  movedSpans,
  type SenseDraft,
  senseRequired,
  type Span,
  spanAt,
  withBlankToggled,
  withCellText,
  withoutColumn,
  withoutRow,
  withSpan,
} from "../authoring";
import type { CellSide, WordAsk } from "../card-content";
import {
  cellSection,
  type Editing,
  EditingContext,
  type Find,
  firstField,
  UndoSnack,
  useEditing,
} from "./editing";
import { type CellChange, PhotoFields, SoundFields } from "./media-fields";
import { RowMenu } from "./row-menu";

type Draft<K extends CellDraft["kind"]> = Extract<CellDraft, { kind: K }>;

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
const chip = `${chipShape} border-outline bg-surface`;
const chipOn = `${chipShape} border-ink bg-brand-tint`;

/**
 * A field that grows with its text and tints each of [marks] in it as a blank, as the phone's line
 * draws its blanks: the text sits in a textarea over a copy that draws the tint. An empty blank,
 * the mark of no width, is a short underline where the caret stands, which moves no text. A table's
 * [shape] "cell" takes the cell's padding in place of the field's; a field is [lines] tall at least.
 */
function Field({
  label,
  value,
  change,
  marks = [],
  placeholder,
  select,
  input,
  keyDown,
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
        className={`absolute inset-0 size-full resize-none overflow-hidden rounded-field bg-transparent ${box} placeholder:text-muted focus:outline-2 focus:-outline-offset-2 focus:outline-ink`}
      />
    </div>
  );
}

function Problem({ children }: { children: string }) {
  return (
    <p role="alert" className="px-4 pb-3 text-caption text-dont-know-text">
      {children}
    </p>
  );
}

/** Two chips of which one holds, in a row named by [label], or by the chips alone. */
function Choices<V extends string>({
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

function TextGroup({ draft, change }: { draft: Draft<"text">; change: (next: CellDraft) => void }) {
  return (
    <div className="divide-y divide-hairline">
      {(["front", "back"] as const).map((side) => (
        <div key={side} className="flex items-start gap-1 px-3 py-1">
          <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
            {side === "front" ? "앞면" : "뒷면"}
          </span>
          <Field
            label={side === "front" ? "앞면" : "뒷면"}
            value={draft[side]}
            change={(value) => {
              change({ ...draft, [side]: value });
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** The row of meaning [key]. */
const senseRow = (key: string | undefined) =>
  key === undefined ? null : document.querySelector(`[data-sense="${key}"]`);

function SenseRow({
  sense,
  at,
  senses,
  showErrors,
  replace,
  remove,
}: {
  sense: SenseDraft;
  at: number;
  senses: SenseDraft[];
  showErrors: boolean;
  replace: (senses: SenseDraft[]) => void;
  remove: () => void;
}) {
  const many = senses.length > 1;
  const name = many ? `뜻 ${String(at + 1)}` : "뜻";
  const update = (fields: Partial<SenseDraft>) => {
    replace(senses.map((item) => (item === sense ? { ...item, ...fields } : item)));
  };
  const moved = (by: number) => {
    const next = [...senses];
    next.splice(at, 1);
    next.splice(at + by, 0, sense);
    replace(next);
  };
  return (
    <div data-sense={sense.key}>
      <div className="flex min-w-0 items-start gap-2 px-3 py-1">
        {/* Its target is the tap target's height: a press around the chip focuses it. */}
        <label className="-mt-0.5 shrink-0 cursor-text py-1.5">
          <input
            aria-label={many ? `${name} 라벨` : "라벨"}
            value={sense.label}
            placeholder="라벨"
            onChange={(event) => {
              update({ label: event.target.value });
            }}
            className="block h-8 w-14 rounded-chip bg-brand-tint px-2 text-center text-secondary placeholder:text-muted focus:outline-2 focus:outline-ink"
          />
        </label>
        <Field
          label={name}
          placeholder="뜻"
          value={sense.meaning}
          change={(meaning) => {
            update({ meaning });
          }}
        />
        {many && (
          <RowMenu
            label={`${String(at + 1)}번째 뜻 메뉴`}
            items={[
              {
                label: "위로",
                disabled: at === 0,
                pick: () => {
                  moved(-1);
                },
              },
              {
                label: "아래로",
                disabled: at === senses.length - 1,
                pick: () => {
                  moved(1);
                },
              },
              { label: "삭제", danger: true, pick: remove },
            ]}
          />
        )}
      </div>
      {sense.withExamples && (
        <div className="flex items-start gap-1 px-3 pb-1">
          <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
            예문
          </span>
          <Field
            label={`${name} 예문`}
            placeholder="한 줄에 하나씩, 없으면 비워 두세요"
            value={sense.examples}
            change={(examples) => {
              update({ examples });
            }}
          />
        </div>
      )}
      {showErrors && sense.meaning.trim() === "" && <Problem>{senseRequired(senses)}</Problem>}
    </div>
  );
}

function WordGroup({
  draft,
  showErrors,
  change,
}: {
  draft: Draft<"word">;
  showErrors: boolean;
  change: (next: CellDraft) => void;
}) {
  const editing = useEditing();
  const replace = (senses: SenseDraft[]) => {
    change({ ...draft, senses });
  };
  return (
    <div className="divide-y divide-hairline">
      <div className="flex items-start gap-1 px-3 py-1">
        <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
          단어
        </span>
        <Field
          label="단어"
          value={draft.term}
          change={(term) => {
            change({ ...draft, term });
          }}
        />
      </div>
      {draft.senses.map((sense, at) => (
        <SenseRow
          key={sense.key}
          sense={sense}
          at={at}
          senses={draft.senses}
          showErrors={showErrors}
          replace={replace}
          remove={() => {
            const { senses } = draft;
            const nearest = senses[at + 1]?.key ?? senses[at - 1]?.key;
            editing.remove({
              said: "뜻을 삭제했어요",
              before: draft,
              after: { ...draft, senses: senses.filter((item) => item !== sense) },
              next: () => firstField(senseRow(nearest)),
              back: () => firstField(senseRow(sense.key)),
            });
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          const added = emptySense();
          replace([...draft.senses, added]);
          editing.focusSoon(() => senseRow(added.key)?.querySelector("textarea"));
        }}
        className="pressable min-h-tap-target w-full px-4 text-left text-body text-ink-2"
      >
        + 뜻 추가
      </button>
      <Choices<WordAsk>
        label="앞면에 보일 것"
        name="앞면에 보일 것"
        choices={[
          ["term", "단어"],
          ["meaning", "뜻"],
        ]}
        value={draft.ask}
        change={(ask) => {
          change({ ...draft, ask });
        }}
      />
    </div>
  );
}

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
function ClozeGroup({
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

/** A 표: a toolbar over a grid of fields that scrolls sideways. A row of -1 is the headers. */
function TableGroup({
  draft,
  showErrors,
  change,
}: {
  draft: Draft<"table">;
  showErrors: boolean;
  change: (next: CellDraft) => void;
}) {
  const [cell, setCell] = useState<{ row: number; column: number } | null>(null);
  const [selection, setSelection] = useState<Span>({ start: 0, end: 0 });
  const grid = useRef<HTMLTableElement>(null);
  const editing = useEditing();
  const body = cell && cell.row >= 0 ? cell : null;
  const isBlank = (row: number, column: number) =>
    draft.blanks.some((blank) => blank.row === row && blank.column === column);
  const hasSpan = (row: number, column: number) =>
    draft.spans.some((span) => span.row === row && span.column === column);
  const heldBy = (row: number, column: number) => isBlank(row, column) || hasSpan(row, column);
  function toNext(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const grid = event.currentTarget.closest("table");
    const fields = Array.from(grid?.querySelectorAll("textarea") ?? []);
    fields[fields.indexOf(event.currentTarget) + 1]?.focus();
  }
  /** The field of [row] (-1 for the headers) and [column]. */
  const fieldAt = (row: number, column: number) =>
    (row < 0
      ? grid.current?.querySelectorAll("thead th")[column]
      : grid.current?.querySelectorAll("tbody tr")[row]?.querySelectorAll("td")[column]
    )?.querySelector("textarea");
  /** Removes [cell]'s row or column at once, the selection kept on the field the caret is in. */
  function remove(what: "row" | "column", { row, column }: { row: number; column: number }) {
    const at = what === "row" ? row : column;
    const kept =
      what === "row"
        ? { row: Math.min(row, draft.rows.length - 2), column }
        : { row, column: Math.min(column, draft.columns.length - 2) };
    // Focusing the kept field selects it, as a press on it does.
    editing.remove({
      said: `${String(at + 1)}${what === "row" ? "행" : "열"}을 삭제했어요`,
      before: draft,
      after: what === "row" ? withoutRow(draft, row) : withoutColumn(draft, column),
      next: () => fieldAt(kept.row, kept.column),
      back: () => fieldAt(row, column),
    });
  }
  const keepFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };
  return (
    <div>
      {/* The phone's fixed toolbar: each control always drawn, off where it cannot act. */}
      <div role="toolbar" aria-label="표 도구" className="flex flex-wrap gap-x-2 gap-y-3 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            change({ ...draft, rows: [...draft.rows, draft.columns.map(() => "")] });
            editing.focusSoon(() => fieldAt(draft.rows.length, 0));
          }}
          className={chip}
        >
          행 추가
        </button>
        <button
          type="button"
          onClick={() => {
            change({
              ...draft,
              columns: [...draft.columns, ""],
              rows: draft.rows.map((row) => [...row, ""]),
            });
            editing.focusSoon(() => fieldAt(-1, draft.columns.length));
          }}
          className={chip}
        >
          열 추가
        </button>
        <button
          type="button"
          disabled={!body}
          aria-pressed={!!body && blankPressed(draft, body.row, body.column, selection)}
          onMouseDown={keepFocus}
          onClick={() => {
            if (body) change(withBlankToggled(draft, body.row, body.column, selection));
          }}
          className={body && blankPressed(draft, body.row, body.column, selection) ? chipOn : chip}
        >
          빈칸
        </button>
        <RowMenu
          label="삭제"
          face="삭제"
          disabled={!cell}
          trigger={chip}
          items={[
            ...(body
              ? [
                  {
                    label: `${String(body.row + 1)}행 삭제`,
                    disabled: draft.rows.length === 1,
                    pick: () => {
                      remove("row", body);
                    },
                  },
                ]
              : []),
            ...(cell
              ? [
                  {
                    label: `${String(cell.column + 1)}열 삭제`,
                    disabled: draft.columns.length === 1,
                    pick: () => {
                      remove("column", cell);
                    },
                  },
                ]
              : []),
          ]}
        />
      </div>
      <div className="overflow-x-auto px-3 pb-3">
        <table ref={grid} className="w-full border-collapse overflow-hidden rounded-field">
          <thead>
            <tr>
              {draft.columns.map((header, column) => (
                <th
                  key={column}
                  scope="col"
                  className={`min-w-36 border border-hairline bg-ground p-0 text-left font-bold ${cell?.row === -1 && cell.column === column ? "outline-2 -outline-offset-2 outline-ink" : ""}`}
                >
                  <Field
                    shape="cell"
                    label={`${String(column + 1)}열 머리글`}
                    value={header}
                    keyDown={toNext}
                    select={() => {
                      setCell({ row: -1, column });
                    }}
                    change={(value) => {
                      change({
                        ...draft,
                        columns: draft.columns.map((text, at) => (at === column ? value : text)),
                      });
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((cells, row) => (
              <tr key={row}>
                {cells.map((text, column) => (
                  <td
                    key={column}
                    className={`min-w-36 border border-hairline p-0 ${isBlank(row, column) ? "bg-brand-tint" : ""} ${column === 0 ? "font-bold" : ""} ${cell?.row === row && cell.column === column ? "outline-2 -outline-offset-2 outline-ink" : ""} ${showErrors && isBlank(row, column) && text.trim() === "" ? "outline-2 -outline-offset-2 outline-dont-know-text" : ""}`}
                  >
                    <Field
                      shape="cell"
                      label={`${String(row + 1)}행 ${String(column + 1)}열${heldBy(row, column) ? ", 빈칸" : ""}`}
                      value={text}
                      marks={draft.spans.filter(
                        (span) => span.row === row && span.column === column,
                      )}
                      keyDown={toNext}
                      select={(next) => {
                        setCell({ row, column });
                        setSelection(next);
                      }}
                      change={(value, next) => {
                        setCell({ row, column });
                        setSelection(next);
                        change(withCellText(draft, row, column, value));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function kindName(draft: CellDraft): string {
  switch (draft.kind) {
    case "text":
      return "글";
    case "word":
      return "단어";
    case "cloze":
      return "빈칸 문장";
    case "table":
      return "표";
    case "image":
      return "사진";
    case "audio":
      return "소리";
  }
}

/** The row of "앞면" and "뒷면" chips choosing the side a 사진 or a 소리 sits on. */
function SideChoices({
  draft,
  change,
}: {
  draft: Draft<"image" | "audio">;
  change: (next: CellDraft) => void;
}) {
  return (
    <Choices<CellSide>
      name="보일 면"
      choices={[
        ["front", "앞면"],
        ["back", "뒷면"],
      ]}
      value={draft.side}
      change={(side) => {
        change({ ...draft, side });
      }}
    />
  );
}

/** One group per 칸, headed by its type's name with its ⋯, as the phone's editor (ADR 0137). */
function CellGroup({
  draft,
  at,
  count,
  showErrors,
  recorder,
  change,
  move,
  remove,
}: {
  draft: CellDraft;
  at: number;
  count: number;
  showErrors: boolean;
  recorder: { taken: boolean; hold: (holding: boolean) => void };
  change: CellChange;
  move: (by: number) => void;
  remove: () => void;
}) {
  const heading = useId();
  const problem = cellProblem(draft);
  return (
    <section aria-labelledby={heading} data-cell={draft.id} className="min-w-0">
      <div className="rounded-group bg-surface">
        <div className="flex min-h-tap-target items-center justify-between pl-4">
          <h3 id={heading} className="text-section text-muted">
            {kindName(draft)}
          </h3>
          <RowMenu
            label={`${String(at + 1)}번째 칸 메뉴`}
            items={[
              {
                label: "위로",
                disabled: at === 0,
                pick: () => {
                  move(-1);
                },
              },
              {
                label: "아래로",
                disabled: at === count - 1,
                pick: () => {
                  move(1);
                },
              },
              { label: "삭제", danger: true, pick: remove },
            ]}
          />
        </div>
        {draft.kind === "text" && <TextGroup draft={draft} change={change} />}
        {draft.kind === "word" && (
          <WordGroup draft={draft} showErrors={showErrors} change={change} />
        )}
        {draft.kind === "cloze" && <ClozeGroup draft={draft} change={change} />}
        {draft.kind === "table" && (
          <TableGroup draft={draft} showErrors={showErrors} change={change} />
        )}
        {draft.kind === "image" && (
          <>
            <PhotoFields draft={draft} change={change} />
            {draft.photo && draft.boxes.length === 0 && (
              <SideChoices draft={draft} change={change} />
            )}
          </>
        )}
        {draft.kind === "audio" && (
          <>
            <SoundFields
              draft={draft}
              change={change}
              recorderTaken={recorder.taken}
              holdRecorder={recorder.hold}
            />
            <SideChoices draft={draft} change={change} />
          </>
        )}
        {showErrors && problem && draft.kind !== "word" && <Problem>{problem}</Problem>}
      </div>
    </section>
  );
}

/**
 * [draft] with each file it picked drawn from a new object URL, for one put back after its own
 * was revoked as it left the editor.
 */
function revived(draft: CellDraft): CellDraft {
  const fresh = <F extends MediaFile>(file: F | null) =>
    file?.upload ? { ...file, url: URL.createObjectURL(file.upload.file) } : file;
  if (draft.kind === "image") return { ...draft, photo: fresh(draft.photo) };
  if (draft.kind === "audio") return { ...draft, sound: fresh(draft.sound) };
  return draft;
}

/**
 * A delete the snack offers back: [restore] puts the 칸 [put] back while [valid] holds, which is
 * while nothing it would undo has changed since, and [back] finds what then takes the focus.
 */
type Offer = {
  said: string;
  put: CellDraft;
  valid: (drafts: CellDraft[]) => boolean;
  restore: (drafts: CellDraft[], put: CellDraft) => CellDraft[];
  back: Find;
};

/**
 * A card's 칸 as a column of groups; "+ 칸 추가" comes after the last, as on the phone. Every delete
 * acts at once and the snack offers the latest back (design.md §Principles 5).
 */
export function CellFields({
  drafts,
  showErrors,
  change,
  add,
}: {
  drafts: CellDraft[];
  showErrors: boolean;
  change: (update: (drafts: CellDraft[]) => CellDraft[]) => void;
  add: () => void;
}) {
  // The 칸 recording, one at a time, as the phone's one recorder.
  const [recording, setRecording] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ key: number; offer: Offer } | null>(null);
  const [focusing, setFocusing] = useState<{ find: Find } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const field = focusing?.find();
    field?.focus();
    // A focus scrolls no grid sideways in Chromium, so a new column's header is brought in too.
    if (field && "scrollIntoView" in field)
      field.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusing]);
  const dismiss = useCallback(() => {
    setOffer(null);
  }, []);
  const offerBack = (next: Offer) => {
    setOffer((now) => ({ key: (now?.key ?? 0) + 1, offer: next }));
  };
  const editing: Editing = {
    remove: ({ said, before, after, next, back }) => {
      change((current) => current.map((item) => (item.id === before.id ? after : item)));
      offerBack({
        said,
        put: before,
        valid: (current) => current.some((item) => item === after),
        restore: (current, put) => current.map((item) => (item === after ? put : item)),
        back,
      });
      setFocusing({ find: next });
    },
    focusSoon: (find) => {
      setFocusing({ find });
    },
  };
  const shown = offer?.offer.valid(drafts) ? offer : null;
  return (
    <EditingContext value={editing}>
      <div className="flex flex-col gap-3">
        {drafts.map((draft, at) => (
          <CellGroup
            key={draft.id}
            draft={draft}
            at={at}
            count={drafts.length}
            showErrors={showErrors}
            recorder={{
              taken: recording !== null && recording !== draft.id,
              hold: (holding) => {
                setRecording((holder) =>
                  holding ? draft.id : holder === draft.id ? null : holder,
                );
              },
            }}
            change={(next) => {
              change((current) =>
                current.map((item) =>
                  item.id === draft.id ? (typeof next === "function" ? next(item) : next) : item,
                ),
              );
            }}
            move={(by) => {
              change((current) => {
                const next = current.filter((item) => item.id !== draft.id);
                next.splice(at + by, 0, current.find((item) => item.id === draft.id) ?? draft);
                return next;
              });
            }}
            remove={() => {
              const following = drafts[at + 1]?.id;
              const preceding = drafts[at - 1]?.id;
              const others = drafts.filter((item) => item !== draft).map((item) => item.id);
              change((current) => current.filter((item) => item.id !== draft.id));
              offerBack({
                said: "칸을 삭제했어요",
                put: draft,
                // A card saved and started again holds none of the 칸 this one was beside.
                valid: (current) =>
                  !current.some((item) => item.id === draft.id) &&
                  (others.length === 0 || current.some((item) => others.includes(item.id))),
                restore: (current, put) => {
                  const next = [...current];
                  const after = next.findIndex((item) => item.id === following);
                  const before = next.findIndex((item) => item.id === preceding);
                  next.splice(after >= 0 ? after : before + 1, 0, put);
                  return next;
                },
                back: () => {
                  const section = cellSection(draft.id);
                  return firstField(section) ?? section?.querySelector("[aria-haspopup]");
                },
              });
              setFocusing({
                find: () =>
                  firstField(cellSection(following)) ??
                  firstField(cellSection(preceding)) ??
                  addButton.current,
              });
            }}
          />
        ))}
        <button
          ref={addButton}
          type="button"
          onClick={add}
          className="pressable min-h-tap-target w-full px-1 text-left text-body text-ink-2"
        >
          + 칸 추가
        </button>
        {shown && (
          <UndoSnack
            key={shown.key}
            said={shown.offer.said}
            dismiss={dismiss}
            undo={() => {
              const { put, restore } = shown.offer;
              // Made once here, not in the update, which may run twice.
              const back = revived(put);
              change((current) => restore(current, back));
              setOffer(null);
              setFocusing({ find: shown.offer.back });
            }}
          />
        )}
      </div>
    </EditingContext>
  );
}
