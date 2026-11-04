"use client";

import type { SheetRow, Spreadsheet } from "../spreadsheet";
import type { Columns } from "../spreadsheet-cards";

type Role = keyof Columns;
const roles: { role: Role; name: string; optional: boolean }[] = [
  { role: "front", name: "앞면", optional: false },
  { role: "back", name: "뒷면", optional: false },
  { role: "label", name: "라벨", optional: true },
  { role: "example", name: "예문", optional: true },
];

/**
 * "열": the sheet of [book] the cards come from, where it holds more than one, the column each of
 * a card's parts comes from, among [width] columns named by their letter and [first] row's text,
 * and whether the first row is the header; asking for another column where two parts share one.
 */
export function SpreadsheetColumns({
  book,
  sheet,
  chooseSheet,
  columns,
  chooseColumn,
  header,
  toggleHeader,
  width,
  first,
  locked,
  distinct,
}: {
  book: Spreadsheet;
  sheet: number;
  chooseSheet: (sheet: number) => void;
  columns: Columns;
  chooseColumn: (role: Role, column: number | null) => void;
  header: boolean;
  toggleHeader: () => void;
  width: number;
  first: SheetRow | undefined;
  locked: boolean;
  distinct: boolean;
}) {
  const columnName = (column: number) => {
    const text = first?.cells[column]?.text ?? "";
    const sample = Array.from(text.split("\n")[0] ?? "")
      .slice(0, 16)
      .join("");
    return sample ? `${letter(column)} · ${sample}` : letter(column);
  };
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-section text-muted">열</h3>
      <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
        {book.sheets.length > 1 && (
          <Choice
            name="시트"
            value={String(sheet)}
            disabled={locked}
            options={book.sheets.map((sheetName, index) => [String(index), sheetName])}
            change={(value) => {
              chooseSheet(Number(value));
            }}
          />
        )}
        {roles.map(({ role, name: roleName, optional }) => (
          <Choice
            key={role}
            name={roleName}
            value={String(columns[role] ?? -1)}
            disabled={locked || width === 0}
            options={[
              ...(optional ? [["-1", "없음"] as [string, string]] : []),
              ...Array.from({ length: width }, (_, column): [string, string] => [
                String(column),
                columnName(column),
              ]),
            ]}
            change={(value) => {
              const column = Number(value);
              chooseColumn(role, column === -1 ? null : column);
            }}
          />
        ))}
        <div className="flex min-h-button items-center justify-between gap-3 px-4">
          <span id="spreadsheet-header" className="text-body">
            첫 행은 머리글
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={header}
            aria-labelledby="spreadsheet-header"
            disabled={locked}
            onClick={toggleHeader}
            className={`pressable relative my-2 h-7 w-12 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 ${header ? "bg-ink" : "bg-outline"}`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-surface shadow-card transition-transform ${header ? "translate-x-5" : ""}`}
            />
          </button>
        </div>
      </div>
      {!distinct && (
        <p role="alert" className="text-caption break-keep text-dont-know">
          항목마다 다른 열을 골라 주세요
        </p>
      )}
    </section>
  );
}

/** A grouped row choosing one option, named by its label. */
function Choice({
  name,
  value,
  options,
  disabled,
  change,
}: {
  name: string;
  value: string;
  options: [string, string][];
  disabled: boolean;
  change: (value: string) => void;
}) {
  return (
    <label className="flex min-h-button min-w-0 items-center justify-between gap-3 px-4">
      <span className="shrink-0 text-body">{name}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          change(event.target.value);
        }}
        className="min-h-tap-target min-w-0 max-w-[60%] truncate rounded-field bg-transparent text-right text-body text-ink-2 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-50"
      >
        {options.map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A column's letter, as the sheet names it: 0 is A, 26 is AA. */
function letter(column: number): string {
  let name = "";
  for (let at = column + 1; at > 0; at = Math.floor((at - 1) / 26))
    name = String.fromCharCode(65 + ((at - 1) % 26)) + name;
  return name;
}
