"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AudioLines, BookA, Image, Table, TextCursorInput, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { addCard, createDeck, editCard, storeCardMedia } from "../actions";
import {
  builtCells,
  cellDraft,
  type CellDraft,
  emptyCell,
  encodeCells,
  pendingUploads,
} from "../authoring";
import { holdsBlank } from "../card-content";
import type { DeckColor } from "../deck-tint";
import type { Card, Deck } from "../library";
import { leaveThen } from "../hooks/use-back-entry";
import { AuthoringScreen, AuthoringSheet } from "./authoring-sheet";
import { CellFields } from "./cell-fields";
import { DeckColorPicker } from "./deck-color-picker";
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
 * With [deck], "카드 추가", which opens the 카드 추가 sheet of the ways to add a card, open on
 * arrival with [adding]; outlined, or the primary fill with [primary], where it is the page's one
 * way on. Without one, "새 노트 만들기" in the primary fill, or "새 노트" as a chip with
 * [compact], which opens 새 노트.
 */
export function AuthoringButton({
  deck,
  primary = false,
  compact = false,
  adding = false,
}: {
  deck?: Deck;
  primary?: boolean;
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
          compact
            ? "pressable flex min-h-tap-target shrink-0 items-center rounded-chip bg-surface px-4 text-label text-ink shadow-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            : `pressable min-h-cta w-full rounded-button px-5 text-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${primary ? "bg-primary text-on-primary" : "bg-surface"}`
        }
      >
        {label}
      </button>
      {screen === "options" && deck && (
        <AuthoringSheet
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
        </AuthoringSheet>
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
        />
      )}
    </>
  );
}

/**
 * 새 노트, the shape of 새 카드 (ADR 0150): its name and its 표지 색, one of the four note colours,
 * each in a group, over "저장", which opens the new note, and "저장하고 카드 추가", which opens it
 * with its 카드 추가 sheet up.
 */
function NewNote({ close }: { close: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<DeckColor>("blue");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const id = useRef(v7());
  const busy = useRef(false);
  const router = useRouter();
  const formId = useId();
  function save(adding: boolean) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        const result = await createDeck(id.current, name, color);
        if (result.saved) {
          leaveThen(() => {
            close();
            router.push(`/decks/${result.deckId}${adding ? "?adding=1" : ""}`);
            router.refresh();
          });
        } else setMessage(result.message);
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
            className="pressable min-h-cta rounded-button bg-surface px-6 text-button break-keep disabled:opacity-50"
          >
            저장
          </button>
          <button
            form={formId}
            value="adding"
            disabled={pending}
            className="pressable min-h-cta rounded-button bg-primary px-4 text-button break-keep text-on-primary disabled:opacity-50"
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
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-2 rounded-group bg-surface px-4 py-4 text-caption text-muted">
          이름
          <input
            autoFocus
            required
            maxLength={500}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink"
          />
        </label>
        <DeckColorPicker legend="표지 색" selected={color} pick={setColor} />
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
  const [duplicate, setDuplicate] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const focusIn = useRef(card ? null : (drafts[0]?.id ?? null));
  const opening = useRef(JSON.stringify(drafts));
  const form = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const built = builtCells(drafts);
  // After an adding sheet's close, which hands focus back to what opened it.
  useEffect(() => {
    if (!focusIn.current) return;
    form.current?.querySelector<HTMLElement>(`[data-cell="${focusIn.current}"] textarea`)?.focus();
    focusIn.current = null;
  }, [drafts]);
  function save(next: boolean, allow = false) {
    if (busy.current) return;
    const { cells } = built;
    if (!cells) {
      setShowErrors(true);
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
          router.refresh();
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
              card
                ? "pressable min-h-cta flex-1 rounded-button bg-primary px-3 text-button text-on-primary disabled:opacity-50"
                : "pressable min-h-cta rounded-button bg-surface px-6 text-button break-keep disabled:opacity-50"
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
              className="pressable min-h-cta rounded-button bg-primary px-4 text-button break-keep text-on-primary disabled:opacity-50"
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
        <AuthoringSheet
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
        </AuthoringSheet>
      )}
      {discarding && (
        <AuthoringSheet
          title="작성 중인 카드를 버릴까요?"
          close={() => {
            setDiscarding(false);
          }}
        >
          <p className="text-secondary text-muted">입력한 내용은 저장되지 않아요.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setDiscarding(false);
              }}
              className="pressable min-h-button text-body"
            >
              계속 쓰기
            </button>
            <button
              type="button"
              onClick={close}
              className="pressable min-h-button rounded-button bg-dont-know px-4 text-button text-on-ink"
            >
              버리기
            </button>
          </div>
        </AuthoringSheet>
      )}
    </AuthoringScreen>
  );
}
