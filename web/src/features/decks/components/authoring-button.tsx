"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AudioLines, BookA, Image, Plus, Table, TextCursorInput, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { addCard, createDeck, decorateDeck, editCard, storeCardMedia } from "../actions";
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
import { leaveThen } from "@/design/use-back-entry";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { Sheet } from "@/design/sheet";
import { AuthoringScreen } from "./authoring-sheet";
import { CellFields } from "./cell-fields";
import { cellSection, firstField } from "./editing";
import { DeckAppearanceFields, type Look, lookedTile, setPhoto } from "./deck-appearance";
import { DeckTile } from "./deck-tile";
import { PhotoImport } from "./photo-import";
import { SideText } from "./side-text";
import { SpreadsheetImport } from "./spreadsheet-import";
import { WholeCells } from "./whole-card";

// The ways to add a card, each its name alone (ADR 0150): the web has all four.
const choices = [
  { choice: "직접 입력", open: "manual" },
  { choice: "사진 찍기", open: "camera" },
  { choice: "앨범에서 고르기", open: "album" },
  { choice: "엑셀·CSV 파일", open: "file" },
] as const;

/** A pair of buttons on one line at a phone's width: the first sized to its label. */
const pairClass = "grid grid-cols-[auto_minmax(0,1fr)] gap-3";

/**
 * With [deck], "+ 카드 추가" beside the note's name, which opens the 카드 추가 sheet of the ways to
 * add a card, open on arrival with [adding]. Without one, "새 노트 만들기" in the primary fill
 * across the column, or, with [compact], "+ 새 노트" beside the 노트 page's title, which opens
 * 새 노트. Beside a title it is the page's own action in the tonal fill, the brand tint under an
 * accent label on the edge a quiet button sits on, 44 high, as the phone's header action.
 */
export function AuthoringButton({
  deck,
  compact = false,
  adding = false,
}: {
  deck?: Deck;
  compact?: boolean;
  adding?: boolean;
}) {
  const [screen, setScreen] = useState<"options" | "manual" | "photo" | "file" | "name" | null>(
    deck && adding ? "options" : null,
  );
  const [camera, setCamera] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const label = deck ? "카드 추가" : compact ? "새 노트" : "새 노트 만들기";
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setScreen(deck ? "options" : "name");
        }}
        className={
          deck || compact
            ? `${buttonClass("tonal", "header")} shrink-0`
            : `${buttonClass("primary", "cta")} w-full`
        }
      >
        {(deck || compact) && <Plus aria-hidden className="size-5" strokeWidth={2.6} />}
        {label}
      </button>
      {screen === "options" && deck && (
        <Sheet
          title="카드 추가"
          close={() => {
            setScreen(null);
          }}
        >
          <div className="flex flex-col gap-3 pb-2">
            {choices.map(({ choice, open }) =>
              open === "camera" || open === "album" ? (
                // The picker opens from the row itself, as the phone's does; a cancel opens nothing.
                <label
                  key={choice}
                  className="pressable flex min-h-cta w-full cursor-pointer items-center rounded-row bg-surface px-4 text-left text-body-strong focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ink"
                >
                  {choice}
                  <input
                    aria-label={choice}
                    type="file"
                    accept="image/*"
                    capture={open === "camera" ? "environment" : undefined}
                    multiple={open === "album"}
                    onChange={(event) => {
                      const chosen = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      if (!chosen.length) return;
                      setCamera(open === "camera");
                      setPhotos(chosen);
                      setScreen("photo");
                    }}
                    className="sr-only"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  key={choice}
                  className="pressable flex min-h-cta w-full items-center rounded-row bg-surface px-4 text-left text-body-strong"
                  onClick={() => {
                    setScreen(open);
                  }}
                >
                  {choice}
                </button>
              ),
            )}
          </div>
        </Sheet>
      )}
      {screen === "name" && (
        <NewNote
          close={() => {
            setScreen(null);
          }}
        />
      )}
      {screen === "manual" && deck && (
        <CardEditor
          deck={deck}
          close={() => {
            setScreen(null);
          }}
        />
      )}
      {screen === "file" && deck && (
        <SpreadsheetImport
          deck={deck}
          close={() => {
            setScreen(null);
          }}
        />
      )}
      {screen === "photo" && deck && (
        <PhotoImport
          deck={deck}
          camera={camera}
          files={photos}
          close={() => {
            setScreen(null);
          }}
          addInstead={setScreen}
        />
      )}
    </>
  );
}

/**
 * 새 노트, the shape of 새 카드 (ADR 0150), as the phone's: the tile the note will get, at twice its
 * size, over its name as typed; "노트 이름" in a group, focused, with its hint; and 노트 꾸미기's
 * choices (`DeckAppearanceFields`), blue first; over "저장", which opens the new note, and
 * "저장하고 카드 추가", which opens it with its 카드 추가 sheet up. An icon or a photo chosen is
 * stored as 노트 꾸미기 stores it, once the note is made; a retry keeps the note's id, so it makes
 * no second note.
 */
function NewNote({ close }: { close: () => void }) {
  const [name, setName] = useState("");
  const [look, setLook] = useState<Look>({
    icon: "layers",
    color: "blue",
    photo: { kind: "none" },
  });
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const id = useRef(v7());
  const busy = useRef(false);
  const router = useRouter();
  const formId = useId();
  const nameId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const typed = name.trim();
  // After the dialog opens, whose focusing steps would move an autofocus away.
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  function save(adding: boolean) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        const result = await createDeck(id.current, name, look.color);
        if (!result.saved) {
          setMessage(result.message);
          return;
        }
        if (look.icon !== "layers" || look.photo.kind === "picked") {
          const form = new FormData();
          form.set("deck", result.deckId);
          form.set("icon", look.icon);
          form.set("color", look.color ?? "");
          setPhoto(form, look.photo);
          const decorated = await decorateDeck(form);
          if (!decorated.saved) {
            setMessage(decorated.message);
            return;
          }
        }
        leaveThen(() => {
          close();
          router.push(`/decks/${result.deckId}${adding ? "?adding=1" : ""}`);
        });
      } catch {
        setMessage("노트를 만들지 못했어요. 다시 시도해 주세요.");
      } finally {
        busy.current = false;
      }
    });
  }
  return (
    <AuthoringScreen
      title="새 노트"
      back
      close={close}
      actions={
        <div className={pairClass}>
          <button
            form={formId}
            value="saved"
            disabled={pending}
            className={buttonClass("secondary", "cta")}
          >
            저장
          </button>
          <button
            form={formId}
            value="adding"
            disabled={pending}
            className={buttonClass("primary", "cta")}
          >
            {pending ? "만드는 중" : "저장하고 카드 추가"}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          const submitter = event.nativeEvent.submitter;
          save(submitter instanceof HTMLButtonElement && submitter.value === "adding");
        }}
        className="flex flex-col gap-3"
      >
        <div aria-hidden className="flex flex-col items-center gap-2 pt-1 pb-1">
          <DeckTile deck={lookedTile(look)} size="size-[calc(var(--spacing-deck-tile)*2)]" />
          <span
            className={`max-w-full text-center text-body-strong break-words ${typed ? "text-ink" : "text-muted"}`}
          >
            {typed || "노트 이름"}
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-group bg-surface px-4 py-4">
          <label htmlFor={nameId} className="text-caption text-muted">
            노트 이름
          </label>
          <input
            ref={nameField}
            id={nameId}
            required
            maxLength={500}
            placeholder="예: 토익 단어"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="min-h-field w-full rounded-field bg-ground px-4 text-body text-ink placeholder:text-muted focus:outline-2 focus:outline-ink"
          />
        </div>
        <DeckAppearanceFields
          look={look}
          change={(next) => {
            setLook(next);
            setMessage("");
          }}
          busy={pending}
        />
        {message && (
          <p role="alert" className="text-caption text-dont-know-text">
            {message}
          </p>
        )}
      </form>
    </AuthoringScreen>
  );
}

// The phone's add sheet: each type its icon, its name and one line.
const cellChoices = [
  { kind: "text", Icon: Type, name: "글", line: "앞면과 뒷면에 글을 적어요" },
  { kind: "word", Icon: BookA, name: "단어", line: "단어와 뜻을 함께 적어요" },
  { kind: "cloze", Icon: TextCursorInput, name: "빈칸 문장", line: "문장 속 단어를 가려요" },
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
