"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v5, v7 } from "uuid";
import { saveCards } from "../actions";
import { describeContent, parseCells, sidesOf } from "../card-content";
import type { Deck } from "../library";
import type { SheetRow, Spreadsheet } from "../spreadsheet";
import {
  cardsOfRows,
  cellLimit,
  type Columns,
  headerByDefault,
  type RowCard,
} from "../spreadsheet-cards";
import { leaveThen } from "../hooks/use-back-entry";
import { AuthoringScreen, AuthoringSheet } from "./authoring-sheet";
import { SideText } from "./side-text";

type Opened = { name: string; book: Spreadsheet };
type Role = keyof Columns;
const roles: { role: Role; name: string; optional: boolean }[] = [
  { role: "front", name: "앞면", optional: false },
  { role: "back", name: "뒷면", optional: false },
  { role: "label", name: "라벨", optional: true },
  { role: "example", name: "예문", optional: true },
];
/** The most cards one save request carries, `saveCards`' own bound. */
const batch = 100;

/**
 * Cards from a spreadsheet's rows, read in the browser, mapped by column and saved into [deck] only
 * once reviewed.
 */
export function SpreadsheetImport({ deck, close }: { deck: Deck; close: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(false);
  const [columns, setColumns] = useState<Columns>({
    front: 0,
    back: 1,
    label: null,
    example: null,
  });
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [duplicateRow, setDuplicateRow] = useState<number | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const [job] = useState(() => v7());
  const router = useRouter();

  const rows = useMemo(() => opened?.book.read(sheet) ?? null, [opened, sheet]);
  const sheetRows = useMemo<SheetRow[]>(() => (rows && !("refused" in rows) ? rows : []), [rows]);
  const width = Math.max(0, ...sheetRows.map((row) => row.cells.length));
  const used = [columns.front, columns.back, columns.label, columns.example].filter(
    (column) => column !== null,
  );
  const distinct = new Set(used).size === used.length;
  const result = useMemo(
    () =>
      cardsOfRows(sheetRows, columns, header, (row) => {
        // The same row under the same mapping keeps its id across renders and retries.
        const key = [
          sheet,
          header,
          columns.front,
          columns.back,
          columns.label,
          columns.example,
          row,
        ].join(":");
        return v5(key, job);
      }),
    [sheetRows, columns, header, sheet, job],
  );
  const cards = distinct ? result.cards : [];
  const chosen = cards.filter((card) => !excluded.has(card.row));
  const unsaved = chosen.filter((card) => !saved.has(card.id));
  const locked = saved.size > 0 || pending;

  function reset() {
    setMessage("");
    setDuplicateRow(null);
  }
  function show(next: SheetRow[] | { refused: string } | null) {
    const list = next && !("refused" in next) ? next : [];
    const count = Math.max(0, ...list.map((row) => row.cells.length));
    setHeader(headerByDefault(list));
    setColumns({ front: 0, back: Math.min(1, Math.max(0, count - 1)), label: null, example: null });
    setExcluded(new Set());
    reset();
  }
  async function open(file: File) {
    setOpening(true);
    reset();
    try {
      const { openSpreadsheet } = await import("../spreadsheet");
      const book = await openSpreadsheet(file);
      if ("refused" in book) {
        setMessage(book.refused);
        return;
      }
      setOpened({ name: file.name, book });
      setSheet(0);
      show(book.read(0));
    } catch {
      setMessage("파일을 읽지 못했어요. 다시 골라 주세요.");
    } finally {
      setOpening(false);
    }
  }
  function leave() {
    if (busy.current) return;
    if (cards.length > 0 && unsaved.length > 0) setDiscarding(true);
    else close();
  }
  function save(allowDuplicate: boolean) {
    if (busy.current) return;
    busy.current = true;
    reset();
    start(async () => {
      try {
        const pendingCards = unsaved;
        for (let offset = 0; offset < pendingCards.length; offset += batch) {
          const part = pendingCards.slice(offset, offset + batch);
          const written = await saveCards(
            deck.id,
            part.map(({ id, blocks }) => ({ id, blocks })),
            "import",
            allowDuplicate,
          );
          if (!written.saved) {
            const repeating = written.at === undefined ? undefined : part[written.at];
            if (written.duplicate && repeating) {
              const earlier = cards.find((card) => card.id === written.duplicate);
              setDuplicateRow(repeating.row);
              setMessage(
                earlier
                  ? `${String(repeating.row)}행의 앞면이 ${String(earlier.row)}행과 같아요`
                  : `${String(repeating.row)}행은 이 노트에 이미 있는 카드예요`,
              );
            } else setMessage(written.message);
            return;
          }
          setSaved((current) => new Set([...current, ...part.map((card) => card.id)]));
        }
        leaveThen(() => {
          close();
          router.push(`/decks/${deck.id}`);
          router.refresh();
        });
      } catch {
        setMessage("카드를 저장하지 못했어요. 다시 시도해 주세요.");
      } finally {
        busy.current = false;
      }
    });
  }

  const picker = (
    <input
      aria-label="파일 고르기"
      type="file"
      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
      disabled={opening || locked}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void open(file);
      }}
      className="sr-only"
    />
  );
  const columnName = (column: number) => {
    const first = sheetRows[0]?.cells[column]?.text ?? "";
    const sample = Array.from(first.split("\n")[0] ?? "")
      .slice(0, 16)
      .join("");
    return sample ? `${letter(column)} · ${sample}` : letter(column);
  };

  const content = (
    <div className="flex min-w-0 flex-col gap-4">
      {!opened && (
        <>
          <p className="text-secondary break-keep text-muted">
            엑셀(.xlsx)이나 CSV 파일의 한 행이 카드 한 장이 돼요. 파일은 5MB, 1,000행까지 읽어요.
          </p>
          <label
            className={`pressable flex min-h-cta cursor-pointer items-center justify-center rounded-button bg-primary px-4 text-button text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${opening ? "opacity-50" : ""}`}
          >
            {opening ? "읽는 중" : "파일 고르기"}
            {picker}
          </label>
        </>
      )}
      {opened && (
        <>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="min-w-0 truncate text-body-strong text-muted">{opened.name}</p>
            <label
              className={`pressable flex min-h-tap-target shrink-0 cursor-pointer items-center px-2 text-body text-ink-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${opening || locked ? "pointer-events-none opacity-50" : ""}`}
            >
              다른 파일
              {picker}
            </label>
          </div>
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="text-section text-muted">열</h3>
            <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
              {opened.book.sheets.length > 1 && (
                <Choice
                  name="시트"
                  value={String(sheet)}
                  disabled={locked}
                  options={opened.book.sheets.map((sheetName, index) => [String(index), sheetName])}
                  change={(value) => {
                    const index = Number(value);
                    setSheet(index);
                    show(opened.book.read(index));
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
                    setColumns({ ...columns, [role]: column === -1 ? null : column });
                    reset();
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
                  onClick={() => {
                    setHeader(!header);
                    reset();
                  }}
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
          {rows && "refused" in rows ? (
            <p role="alert" className="text-caption break-keep text-dont-know">
              {rows.refused}
            </p>
          ) : (
            distinct && (
              <section className="flex min-w-0 flex-col gap-2">
                <div className="flex min-h-tap-target items-center justify-between gap-3">
                  <h3 className="text-section text-muted">카드 {cards.length}장</h3>
                  {cards.length > 0 && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        setExcluded(
                          chosen.length > 0 ? new Set(cards.map((card) => card.row)) : new Set(),
                        );
                        reset();
                      }}
                      className="pressable min-h-tap-target px-2 text-body text-ink-2 disabled:opacity-50"
                    >
                      {chosen.length > 0 ? "모두 빼기" : "모두 선택"}
                    </button>
                  )}
                </div>
                {(result.skipped.length > 0 || result.tooLong.length > 0) && (
                  <ul role="status" className="flex flex-col gap-1 text-caption break-keep">
                    {result.skipped.length > 0 && (
                      <li className="text-muted">
                        앞면이나 뒷면이 빈 행 {result.skipped.length}개는 건너뛰어요
                      </li>
                    )}
                    {result.tooLong.length > 0 && (
                      <li className="text-dont-know">
                        {rowList(result.tooLong)}은 {cellLimit}자가 넘는 칸이 있어 뺐어요
                      </li>
                    )}
                  </ul>
                )}
                {cards.length > 0 && (
                  <ul className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
                    {cards.map((card) => (
                      <CardRow
                        key={card.id}
                        card={card}
                        selected={!excluded.has(card.row)}
                        saved={saved.has(card.id)}
                        disabled={pending}
                        toggle={() => {
                          const next = new Set(excluded);
                          if (next.has(card.row)) next.delete(card.row);
                          else next.add(card.row);
                          setExcluded(next);
                          reset();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          )}
        </>
      )}
      {message && (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-caption break-keep text-dont-know">
            {message}
          </p>
          {duplicateRow !== null && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setExcluded(new Set([...excluded, duplicateRow]));
                  reset();
                }}
                className="pressable min-h-tap-target px-2 text-body text-ink-2"
              >
                {duplicateRow}행 빼기
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  save(true);
                }}
                className="pressable min-h-tap-target px-2 text-body"
              >
                그래도 추가
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
  // The sheet stating the limits picks the file; the review is a screen, as the phone pushes it.
  if (!opened)
    return (
      <AuthoringSheet title="파일에서 카드 추가" close={leave}>
        {content}
      </AuthoringSheet>
    );
  return (
    <AuthoringScreen
      title="카드 확인"
      heading="body"
      close={leave}
      actions={
        cards.length > 0 && (
          <button
            type="button"
            disabled={pending || unsaved.length === 0}
            onClick={() => {
              save(false);
            }}
            className="pressable min-h-cta w-full rounded-button bg-primary px-4 text-button text-on-primary disabled:opacity-50"
          >
            {pending ? "저장 중" : `${String(unsaved.length)}장 추가`}
          </button>
        )
      }
    >
      {content}
      {discarding && (
        <AuthoringSheet
          title="읽은 카드를 버릴까요?"
          close={() => {
            setDiscarding(false);
          }}
        >
          <p className="text-secondary break-keep text-muted">저장하지 않은 카드는 사라져요.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setDiscarding(false);
              }}
              className="pressable min-h-button text-body"
            >
              취소
            </button>
            <button
              type="button"
              onClick={close}
              className="pressable min-h-button rounded-button bg-dont-know text-button text-on-ink"
            >
              버리기
            </button>
          </div>
        </AuthoringSheet>
      )}
    </AuthoringScreen>
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

/** A row's card with its round check, its sheet row and whether it is already saved. */
function CardRow({
  card,
  selected,
  saved,
  disabled,
  toggle,
}: {
  card: RowCard;
  selected: boolean;
  saved: boolean;
  disabled: boolean;
  toggle: () => void;
}) {
  const { front, back } = sidesOf(parseCells(card.blocks) ?? []);
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${String(card.row)}행 ${describeContent(front)}${saved ? ", 저장됨" : ""}`}
        disabled={disabled || saved}
        onClick={toggle}
        className="pressable flex min-h-cta w-full min-w-0 items-start gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-body ${selected ? "border-ink bg-ink text-on-ink" : "border-outline"}`}
        >
          {selected ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1 break-words">
          <span className="block text-body-strong whitespace-pre-line">
            <SideText blocks={front} />
          </span>
          <span className="mt-1 block text-caption whitespace-pre-line text-muted">
            <SideText blocks={back} />
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-caption text-muted">
          {saved ? "저장됨" : `${String(card.row)}행`}
        </span>
      </button>
    </li>
  );
}

/** A column's letter, as the sheet names it: 0 is A, 26 is AA. */
function letter(column: number): string {
  let name = "";
  for (let at = column + 1; at > 0; at = Math.floor((at - 1) / 26))
    name = String.fromCharCode(65 + ((at - 1) % 26)) + name;
  return name;
}

/** Up to five row numbers, then how many more: "3행, 9행 외 4개 행". */
function rowList(rows: number[]): string {
  const named = rows
    .slice(0, 5)
    .map((row) => `${String(row)}행`)
    .join(", ");
  return rows.length > 5 ? `${named} 외 ${String(rows.length - 5)}개 행` : named;
}
