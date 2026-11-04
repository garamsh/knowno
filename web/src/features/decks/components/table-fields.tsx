"use client";

import { type KeyboardEvent, useRef, useState } from "react";
import {
  blankPressed,
  type CellDraft,
  type Span,
  withBlankToggled,
  withCellText,
  withoutColumn,
  withoutRow,
} from "../authoring";
import { useEditing } from "./editing";
import { chip, chipOn, type Draft, Field } from "./editor-field";
import { RowMenu } from "./row-menu";

/** A 표: a toolbar over a grid of fields that scrolls sideways. A row of -1 is the headers. */
export function TableGroup({
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
