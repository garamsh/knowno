"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { addCard, createDeck, editCard } from "../actions";
import { builtCells, cellDraft, type CellDraft, emptyCell, encodeCells } from "../authoring";
import { holdsBlank } from "../card-content";
import type { Card, Deck } from "../library";
import { AuthoringSheet } from "./authoring-sheet";
import { CellFields } from "./cell-fields";
import { PhotoImport } from "./photo-import";
import { SideText } from "./side-text";
import { SpreadsheetImport } from "./spreadsheet-import";
import { WholeCells } from "./whole-card";

const choices = [
  { choice: "직접 입력", line: "", open: "manual" },
  { choice: "사진 찍기", line: "단어장을 찍으면 카드를 찾아 드려요", open: "camera" },
  { choice: "앨범에서 고르기", line: "사진에서 카드를 찾아 드려요", open: "album" },
  { choice: "파일에서 고르기", line: "엑셀이나 CSV 파일의 행을 카드로 만들어요", open: "file" },
] as const;

/**
 * A creation entry opens the phone's three choices and a spreadsheet file without leaving the page.
 * It is outlined, or the coral fill with [primary], where it is the page's one way on.
 */
export function AuthoringButton({
  deck,
  decks = [],
  primary = false,
}: {
  deck?: Deck;
  decks?: Deck[];
  primary?: boolean;
}) {
  const [screen, setScreen] = useState<"options" | "name" | "manual" | "photo" | "file" | null>(
    null,
  );
  const [camera, setCamera] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const label = deck ? "카드 추가" : "새 덱 만들기";
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setScreen("options");
        }}
        className={`pressable min-h-cta w-full rounded-button px-5 text-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${primary ? "bg-primary text-on-primary" : "bg-surface"}`}
      >
        {label}
      </button>
      {screen === "options" && (
        <AuthoringSheet
          title={deck ? "카드 추가" : "새 덱"}
          close={() => {
            setScreen(null);
          }}
        >
          <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
            {choices.map(({ choice, line, open }) =>
              open === "camera" || open === "album" ? (
                // The picker opens from the row itself, as the phone's does; a cancel opens nothing.
                <label
                  key={choice}
                  className="pressable flex min-h-button w-full cursor-pointer flex-col items-start px-4 py-4 text-left text-body focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ink"
                >
                  {choice}
                  <span className="text-caption text-muted">{line}</span>
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
                  aria-label={choice}
                  className="pressable flex min-h-button w-full flex-col items-start px-4 py-4 text-left text-body"
                  onClick={() => {
                    if (open === "manual") setScreen(deck ? "manual" : "name");
                    else setScreen("file");
                  }}
                >
                  {choice}
                  {line && <span className="text-caption text-muted">{line}</span>}
                </button>
              ),
            )}
          </div>
        </AuthoringSheet>
      )}
      {screen === "name" && (
        <NewDeck
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
      {screen === "file" && (
        <SpreadsheetImport
          deck={deck}
          decks={decks}
          close={() => {
            setScreen(null);
          }}
        />
      )}
      {screen === "photo" && (
        <PhotoImport
          deck={deck}
          decks={decks}
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

function NewDeck({ close }: { close: () => void }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const id = useRef(v7());
  const busy = useRef(false);
  const router = useRouter();
  return (
    <AuthoringSheet title="새 덱" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy.current) return;
          busy.current = true;
          start(async () => {
            try {
              const result = await createDeck(id.current, name);
              if (result.saved) {
                close();
                router.push(`/decks/${result.deckId}`);
                router.refresh();
              } else setMessage(result.message);
            } catch {
              setMessage("덱을 만들지 못했어요. 다시 시도해 주세요.");
            } finally {
              busy.current = false;
            }
          });
        }}
        className="flex flex-col gap-4"
      >
        <label className="text-section text-muted">
          이름
          <input
            autoFocus
            required
            maxLength={500}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="mt-2 min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink"
          />
        </label>
        {message && (
          <p role="alert" className="text-caption text-dont-know">
            {message}
          </p>
        )}
        <button
          disabled={pending}
          className="pressable min-h-cta rounded-button bg-primary px-5 text-button text-on-primary disabled:opacity-50"
        >
          {pending ? "만드는 중" : "만들기"}
        </button>
      </form>
    </AuthoringSheet>
  );
}
const cellChoices = [
  { kind: "text", name: "글", line: "" },
  { kind: "word", name: "단어", line: "단어와 뜻을 함께 적어요" },
  { kind: "cloze", name: "빈칸 문장", line: "문장 속 단어를 가려요" },
  { kind: "table", name: "표", line: "가릴 부분을 골라요" },
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
    <AuthoringSheet title="카드 편집" close={close}>
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
    </AuthoringSheet>
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
    <AuthoringSheet
      title={card ? "카드 편집" : "새 카드"}
      close={() => {
        if (busy.current) return;
        if (JSON.stringify(drafts) !== opening.current) setDiscarding(true);
        else close();
      }}
    >
      <p aria-label={`${deck.name} 덱`} className="mb-4 truncate px-1 text-caption text-muted">
        {deck.name}
      </p>
      <div ref={form}>
        <CellFields
          drafts={drafts}
          showErrors={showErrors}
          change={(value) => {
            setDrafts(value);
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
      <div className="sticky bottom-0 mt-5 flex gap-3 bg-ground py-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            save(false);
          }}
          className={
            card
              ? "pressable min-h-cta flex-1 rounded-button bg-primary px-3 text-button text-on-primary disabled:opacity-50"
              : "pressable min-h-cta flex-1 rounded-button bg-surface px-3 text-button disabled:opacity-50"
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
            className="pressable min-h-cta flex-1 rounded-button bg-primary px-3 text-button text-on-primary disabled:opacity-50"
          >
            {pending ? "저장 중" : "저장하고 다음 카드"}
          </button>
        )}
      </div>
      {adding && (
        <AuthoringSheet
          title="칸 추가"
          close={() => {
            setAdding(false);
          }}
        >
          <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
            {cellChoices.map(({ kind, name, line }) => (
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
                className="pressable flex min-h-button w-full flex-col items-start px-4 py-4 text-left text-body"
              >
                {name}
                {line && <span className="text-caption text-muted">{line}</span>}
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
          <p className="text-secondary text-muted">저장하지 않은 내용은 사라져요.</p>
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
    </AuthoringSheet>
  );
}
