"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
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
  movedSpans,
  onSide,
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
import { AuthoringSheet } from "./authoring-sheet";
import { RowMenu } from "./row-menu";
import { WholeCard } from "./whole-card";

type Draft<K extends CellDraft["kind"]> = Extract<CellDraft, { kind: K }>;

/** A field's box, padded as the phone's `AppTextField`: 16 across, and down the field's height past a line. */
const fieldBox =
  "min-h-field whitespace-pre-wrap break-words field-padding text-body";
/** A table cell's box, padded 12 on every side as the phone's table pads a cell's field. */
const cellBox = "whitespace-pre-wrap break-words p-3 text-body";
/** A small outlined control, its target the tap target's height past what it draws. */
const chipShape =
  "pressable relative h-8 rounded-chip border px-3 text-secondary before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] disabled:opacity-40";
const chip = `${chipShape} border-outline bg-surface`;
const chipOn = `${chipShape} border-ink bg-brand-tint`;

/**
 * A field that grows with its text and tints each of [marks] in it as a blank, as the phone's line
 * draws its blanks: the text sits in a textarea over a copy that draws the tint. An empty blank,
 * the mark of no width, is a short underline where the caret stands, which moves no text. A table's
 * [shape] "cell" takes the cell's padding in place of the field's.
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
}: {
  shape?: "field" | "cell";
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
  const box = shape === "cell" ? cellBox : fieldBox;
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

function SenseRow({
  sense,
  at,
  senses,
  showErrors,
  replace,
}: {
  sense: SenseDraft;
  at: number;
  senses: SenseDraft[];
  showErrors: boolean;
  replace: (senses: SenseDraft[]) => void;
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
    <div>
      <div className="flex min-w-0 items-start gap-2 px-3 py-1">
        <input
          aria-label={many ? `${name} 라벨` : "라벨"}
          value={sense.label}
          placeholder="라벨"
          onChange={(event) => {
            update({ label: event.target.value });
          }}
          className="mt-1 h-8 w-14 shrink-0 rounded-chip bg-brand-tint px-2 text-center text-secondary placeholder:text-muted focus:outline-2 focus:outline-ink"
        />
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
              {
                label: "삭제",
                danger: true,
                pick: () => {
                  replace(senses.filter((item) => item !== sense));
                },
              },
            ]}
          />
        )}
      </div>
      {sense.withExamples && (
        <div className="px-3 pb-1">
          <Field
            label={`${name} 예문`}
            placeholder="예문"
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
        />
      ))}
      <button
        type="button"
        onClick={() => {
          replace([...draft.senses, emptySense()]);
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
        placeholder="문장을 적고 가릴 곳을 골라요"
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
  const [removing, setRemoving] = useState<{ row: number } | { column: number } | null>(null);
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
  function remove(target: { row: number } | { column: number }) {
    change("row" in target ? withoutRow(draft, target.row) : withoutColumn(draft, target.column));
    setCell(null);
    setRemoving(null);
  }
  function asked(target: { row: number } | { column: number }) {
    const text =
      "row" in target
        ? draft.rows[target.row]
        : draft.rows
            .map((row) => row[target.column] ?? "")
            .concat(draft.columns[target.column] ?? "");
    if (text?.some((value) => value.trim() !== "")) setRemoving(target);
    else remove(target);
  }
  const keepFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };
  const rowName = (target: { row: number }) => `${String(target.row + 1)}행`;
  const columnName = (target: { column: number }) => `${String(target.column + 1)}열`;
  return (
    <div>
      <div role="toolbar" aria-label="표 도구" className="flex flex-wrap gap-x-2 gap-y-3 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            change({ ...draft, rows: [...draft.rows, draft.columns.map(() => "")] });
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
          }}
          className={chip}
        >
          열 추가
        </button>
        {body && (
          <button
            type="button"
            aria-pressed={blankPressed(draft, body.row, body.column, selection)}
            onMouseDown={keepFocus}
            onClick={() => {
              change(withBlankToggled(draft, body.row, body.column, selection));
            }}
            className={blankPressed(draft, body.row, body.column, selection) ? chipOn : chip}
          >
            빈칸
          </button>
        )}
        {body && (
          <button
            type="button"
            disabled={draft.rows.length === 1}
            onMouseDown={keepFocus}
            onClick={() => {
              asked({ row: body.row });
            }}
            className={chip}
          >
            {`${rowName(body)} 삭제`}
          </button>
        )}
        {cell && (
          <button
            type="button"
            disabled={draft.columns.length === 1}
            onMouseDown={keepFocus}
            onClick={() => {
              asked({ column: cell.column });
            }}
            className={chip}
          >
            {`${columnName(cell)} 삭제`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full border-collapse overflow-hidden rounded-field">
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
      {removing && (
        <AuthoringSheet
          title={`${"row" in removing ? rowName(removing) : columnName(removing)}을 삭제할까요?`}
          close={() => {
            setRemoving(null);
          }}
        >
          <p className="text-secondary text-muted">그 줄에 적은 내용도 함께 삭제돼요.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setRemoving(null);
              }}
              className="pressable min-h-button text-body"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                remove(removing);
              }}
              className="pressable min-h-button rounded-button bg-dont-know px-4 text-button text-on-ink"
            >
              삭제
            </button>
          </div>
        </AuthoringSheet>
      )}
    </div>
  );
}

/** A stored 사진 or 소리: drawn as it is, its media kept, and its side chosen while it has one. */
function KeptGroup({ draft, change }: { draft: Draft<"kept">; change: (next: CellDraft) => void }) {
  const { cell } = draft;
  return (
    <div className="divide-y divide-hairline">
      {cell.block.kind === "image" ? (
        <div className="p-3">
          <div className="mx-auto max-w-56">
            <WholeCard blocks={[cell.block]} revealed />
          </div>
          <p className="mt-2 text-center text-caption text-muted">사진은 앱에서 볼 수 있어요</p>
        </div>
      ) : (
        <div className="px-4 py-3">
          <WholeCard blocks={[cell.block]} revealed inRow />
        </div>
      )}
      {cell.kind === "placed" && (
        <Choices<CellSide>
          name="보일 면"
          choices={[
            ["front", "앞면"],
            ["back", "뒷면"],
          ]}
          value={cell.side}
          change={(side) => {
            change(onSide(draft, side));
          }}
        />
      )}
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
    case "kept":
      return draft.cell.block.kind === "image" ? "사진" : "소리";
  }
}

/** One group per 칸, headed by its type's name with its ⋯, as the phone's editor (ADR 0137). */
function CellGroup({
  draft,
  at,
  count,
  showErrors,
  change,
  move,
  remove,
}: {
  draft: CellDraft;
  at: number;
  count: number;
  showErrors: boolean;
  change: (next: CellDraft) => void;
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
        {draft.kind === "kept" && <KeptGroup draft={draft} change={change} />}
        {showErrors && problem && draft.kind !== "word" && <Problem>{problem}</Problem>}
      </div>
    </section>
  );
}

/** A card's 칸 as a column of groups; "+ 칸 추가" comes after the last, as on the phone. */
export function CellFields({
  drafts,
  showErrors,
  change,
  add,
}: {
  drafts: CellDraft[];
  showErrors: boolean;
  change: (drafts: CellDraft[]) => void;
  add: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft, at) => (
        <CellGroup
          key={draft.id}
          draft={draft}
          at={at}
          count={drafts.length}
          showErrors={showErrors}
          change={(next) => {
            change(drafts.map((item) => (item.id === draft.id ? next : item)));
          }}
          move={(by) => {
            const next = drafts.filter((item) => item !== draft);
            next.splice(at + by, 0, draft);
            change(next);
          }}
          remove={() => {
            change(drafts.filter((item) => item !== draft));
          }}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="pressable min-h-tap-target w-full px-1 text-left text-body text-ink-2"
      >
        + 칸 추가
      </button>
    </div>
  );
}
