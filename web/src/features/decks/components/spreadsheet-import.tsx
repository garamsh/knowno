"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v5, v7 } from "uuid";
import { saveCards } from "../actions";
import type { Deck } from "../library";
import type { SheetRow, Spreadsheet } from "../spreadsheet";
import { cardsOfRows, type Columns, headerByDefault } from "../spreadsheet-cards";
import { leaveThen } from "@/design/use-back-entry";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { Sheet } from "@/design/sheet";
import { AuthoringScreen } from "./authoring-sheet";
import { SpreadsheetColumns } from "./spreadsheet-columns";
import { SpreadsheetRows } from "./spreadsheet-rows";

type Opened = { name: string; book: Spreadsheet };
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
  const content = (
    <div className="flex min-w-0 flex-col gap-4">
      {!opened && (
        <>
          <p className="text-secondary break-keep text-muted">
            엑셀(.xlsx)이나 CSV 파일의 한 행이 카드 한 장이 돼요. 파일은 5MB, 1,000행까지 읽어요.
          </p>
          <label className={`${buttonClass("primary", "cta")} ${opening ? "opacity-50" : ""}`}>
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
          <SpreadsheetColumns
            book={opened.book}
            sheet={sheet}
            chooseSheet={(index) => {
              setSheet(index);
              show(opened.book.read(index));
            }}
            columns={columns}
            chooseColumn={(role, column) => {
              setColumns({ ...columns, [role]: column });
              reset();
            }}
            header={header}
            toggleHeader={() => {
              setHeader(!header);
              reset();
            }}
            width={width}
            first={sheetRows[0]}
            locked={locked}
            distinct={distinct}
          />
          {rows && "refused" in rows ? (
            <p role="alert" className="text-caption break-keep text-dont-know">
              {rows.refused}
            </p>
          ) : (
            distinct && (
              <SpreadsheetRows
                result={result}
                excluded={excluded}
                change={(next) => {
                  setExcluded(next);
                  reset();
                }}
                saved={saved}
                pending={pending}
                locked={locked}
              />
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
      <Sheet title="파일에서 카드 추가" close={leave}>
        {content}
      </Sheet>
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
            className={`${buttonClass("primary", "cta")} w-full`}
          >
            {pending ? "저장 중" : `${String(unsaved.length)}장 추가`}
          </button>
        )
      }
    >
      {content}
      {discarding && (
        <Confirm
          title="읽은 카드를 버릴까요?"
          consequence="저장하지 않은 카드는 사라져요."
          confirmLabel="버리기"
          destructive
          onConfirm={close}
          close={() => {
            setDiscarding(false);
          }}
        />
      )}
    </AuthoringScreen>
  );
}
