"use client";

import { describeContent, parseCells, sidesOf } from "../card-content";
import { cellLimit, type RowCard, type SheetCards } from "../spreadsheet-cards";
import { SideText } from "./side-text";

/**
 * "카드 n장": the rows read as cards, each checked unless [excluded] by its row, with "모두 빼기" or
 * "모두 선택" over them and the rows [result] skipped or left out as too long. A card [saved]
 * already is drawn so and can no longer be left out; [change] takes the rows left out next.
 */
export function SpreadsheetRows({
  result,
  excluded,
  change,
  saved,
  pending,
  locked,
}: {
  result: SheetCards;
  excluded: ReadonlySet<number>;
  change: (excluded: ReadonlySet<number>) => void;
  saved: ReadonlySet<string>;
  pending: boolean;
  locked: boolean;
}) {
  const { cards } = result;
  const anyChosen = cards.some((card) => !excluded.has(card.row));
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-tap-target items-center justify-between gap-3">
        <h3 className="text-section text-muted">카드 {cards.length}장</h3>
        {cards.length > 0 && (
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              change(anyChosen ? new Set(cards.map((card) => card.row)) : new Set());
            }}
            className="pressable min-h-tap-target px-2 text-body text-ink-2 disabled:opacity-50"
          >
            {anyChosen ? "모두 빼기" : "모두 선택"}
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
                change(next);
              }}
            />
          ))}
        </ul>
      )}
    </section>
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

/** Up to five row numbers, then how many more: "3행, 9행 외 4개 행". */
function rowList(rows: number[]): string {
  const named = rows
    .slice(0, 5)
    .map((row) => `${String(row)}행`)
    .join(", ");
  return rows.length > 5 ? `${named} 외 ${String(rows.length - 5)}개 행` : named;
}
