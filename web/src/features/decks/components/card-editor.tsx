"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AudioLines, BookA, Image, Table, TextCursorInput, Type } from "lucide-react";
import { v7 } from "uuid";
import { addCard, editCard, storeCardMedia } from "../actions";
import {
  builtCells,
  cellDraft,
  type CellDraft,
  emptyCell,
  encodeCells,
  pendingUploads,
} from "../authoring";
import { holdsBlank } from "../card-content";
import type { Card, Deck } from "../library";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { Sheet } from "@/design/sheet";
import { useMarkupReady } from "@/design/use-markup-ready";
import { AuthoringScreen, pairClass } from "./authoring-sheet";
import { CellFields } from "./cell-fields";
import { cellSection, firstField } from "./editing";
import { SideText } from "./side-text";
import { WholeCells } from "./whole-card";

// The phone's add sheet: each type its icon, its name and one line.
const cellChoices = [
  { kind: "text", Icon: Type, name: "글", line: "앞면과 뒷면에 글을 적어요" },
  { kind: "word", Icon: BookA, name: "단어", line: "단어와 뜻을 함께 적어요" },
  { kind: "anki", Icon: TextCursorInput, name: "빈칸 문장", line: "문장 속 단어를 가려요" },
  { kind: "table", Icon: Table, name: "표", line: "가릴 부분을 골라요" },
  { kind: "image", Icon: Image, name: "사진", line: "사진 위에 가릴 곳을 그려요" },
  { kind: "audio", Icon: AudioLines, name: "소리", line: "녹음하거나 파일을 넣어요" },
] as const;

/** The editor's starting 칸: a stored card's, or one empty 글. */
function openingCells(card: Card | undefined): CellDraft[] {
  if (!card) return [emptyCell("text")];
  return card.cells.flatMap((cell) => (cell.kind === "unknown" ? [] : [cellDraft(cell)]));
}

/** The phone's editor on the web: a new card, or [card] when it names one this build can edit. */
export function CardEditor({ deck, card, close }: { deck: Deck; card?: Card; close: () => void }) {
  // The editor reads and writes card text through the engine, so it opens once the module has loaded.
  const ready = useMarkupReady();
  if (!ready) return null;
  if (card?.readOnly) return <ReadOnlyCard card={card} close={close} />;
  return <EditableCard deck={deck} card={card} close={close} />;
}

/** A card this build cannot edit: shown as it is, with why, and nothing to save (ADR 0106). */
function ReadOnlyCard({ card, close }: { card: Card; close: () => void }) {
  return (
    <AuthoringScreen title="카드 편집" close={close}>
      <div className="flex flex-col gap-2 rounded-group bg-surface p-4">
        {holdsBlank(card.cells) ? (
          <WholeCells cells={card.cells} revealed />
        ) : (
          <>
            <span className="text-body-strong break-words">
              <SideText blocks={card.front} />
            </span>
            <span className="text-secondary break-words text-muted">
              <SideText blocks={card.back} />
            </span>
          </>
        )}
      </div>
      <p className="mt-4 text-body text-ink-2">
        새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.
      </p>
    </AuthoringScreen>
  );
}

function EditableCard({ deck, card, close }: { deck: Deck; card?: Card; close: () => void }) {
  const [drafts, setDrafts] = useState(() => openingCells(card));
  const [cardId, setCardId] = useState<string>(card?.id ?? v7());
  const [message, setMessage] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  // Counts the refused saves, so each one reveals its problem once drawn.
  const [refused, setRefused] = useState(0);
  const [duplicate, setDuplicate] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const focusIn = useRef(card ? null : (drafts[0]?.id ?? null));
  const opening = useRef(JSON.stringify(drafts));
  const form = useRef<HTMLDivElement>(null);
  const built = builtCells(drafts);
  // After an adding sheet's close, which hands focus back to what opened it.
  useEffect(() => {
    if (!focusIn.current) return;
    firstField(cellSection(focusIn.current))?.focus();
    focusIn.current = null;
  }, [drafts]);
  // A refused save shows its first problem and focuses the field of the 칸 it is in.
  useEffect(() => {
    if (refused === 0) return;
    const alert = form.current?.querySelector<HTMLElement>("[role=alert]");
    if (!alert) return;
    if ("scrollIntoView" in alert) alert.scrollIntoView({ block: "nearest" });
    firstField(alert.closest("[data-cell]"))?.focus();
  }, [refused]);
  function save(next: boolean, allow = false) {
    if (busy.current) return;
    const { cells } = built;
    if (!cells) {
      setShowErrors(true);
      setRefused((count) => count + 1);
      return;
    }
    busy.current = true;
    start(async () => {
      try {
        // Each new photo and sound is stored first, one request each, so the card names only
        // files the server holds; a card refused releases them, and the next save stores them
        // again (ADR 0163).
        for (const upload of pendingUploads(drafts)) {
          const form = new FormData();
          form.set("media", upload.media);
          form.set("kind", upload.kind);
          form.set("file", upload.file);
          form.set("sha256", upload.sha256);
          const stored = await storeCardMedia(form);
          if (!stored.stored) {
            setMessage(stored.message);
            return;
          }
        }
        const written = { id: cardId, blocks: encodeCells(cells) };
        const result = card
          ? await editCard(deck.id, card.id, written, allow)
          : await addCard(deck.id, written, allow);
        if (result.saved) {
          setMessage("");
          setDuplicate(false);
          if (next) {
            const fresh = [emptyCell("text")];
            setDrafts(fresh);
            setCardId(v7());
            setShowErrors(false);
            opening.current = JSON.stringify(fresh);
            focusIn.current = fresh[0]?.id ?? null;
          } else close();
        } else {
          setMessage(result.message);
          setDuplicate(!!result.duplicate);
        }
      } catch {
        setMessage("카드를 저장하지 못했어요. 다시 시도해 주세요.");
      } finally {
        busy.current = false;
      }
    });
  }
  return (
    <AuthoringScreen
      title={card ? "카드 편집" : "새 카드"}
      actions={
        <div className={card ? "flex" : pairClass}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              save(false);
            }}
            className={
              card ? `${buttonClass("primary", "cta")} flex-1` : buttonClass("secondary", "cta")
            }
          >
            {card && pending ? "저장 중" : "저장"}
          </button>
          {!card && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                save(true);
              }}
              className={buttonClass("primary", "cta")}
            >
              {pending ? "저장 중" : "저장하고 다음 카드"}
            </button>
          )}
        </div>
      }
      close={() => {
        if (busy.current) return;
        if (JSON.stringify(drafts) !== opening.current) setDiscarding(true);
        else close();
      }}
    >
      <p aria-label={`${deck.name} 노트`} className="mb-4 truncate px-1 text-caption text-muted">
        {deck.name}
      </p>
      <div ref={form}>
        <CellFields
          drafts={drafts}
          showErrors={showErrors}
          change={(update) => {
            setDrafts(update);
            setDuplicate(false);
            setMessage("");
          }}
          add={() => {
            setAdding(true);
          }}
        />
      </div>
      {showErrors && built.message && (
        <p role="alert" className="mt-2 px-1 text-caption text-dont-know-text">
          {built.message}
        </p>
      )}
      {message && (
        <p role="alert" className="mt-2 px-1 text-caption text-dont-know-text">
          {message}
        </p>
      )}
      {duplicate && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            save(false, true);
          }}
          className="pressable mt-2 min-h-button w-full text-body"
        >
          {card ? "그래도 저장" : "그래도 추가"}
        </button>
      )}
      {adding && (
        <Sheet
          title="칸 추가"
          close={() => {
            setAdding(false);
          }}
        >
          <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
            {cellChoices.map(({ kind, Icon, name, line }) => (
              <button
                key={kind}
                type="button"
                aria-label={name}
                onClick={() => {
                  const added = emptyCell(kind);
                  setDrafts([...drafts, added]);
                  focusIn.current = added.id;
                  setAdding(false);
                }}
                className="pressable flex min-h-button w-full items-center gap-4 px-4 py-3 text-left text-body"
              >
                <Icon aria-hidden className="size-6 shrink-0 text-ink-2" />
                <span className="flex flex-col">
                  <span className="text-body-strong">{name}</span>
                  <span className="text-caption text-muted">{line}</span>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {discarding && (
        <Confirm
          title="작성 중인 카드를 버릴까요?"
          consequence="입력한 내용은 저장되지 않아요."
          cancelLabel="계속 쓰기"
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
