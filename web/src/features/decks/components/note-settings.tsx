"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { ankiNotes } from "../anki-export";
import { decorateDeck, deleteDeck, publishDeck, renameDeck, unpublishDeck } from "../actions";
import { parseDeckIcon } from "../deck-icon";
import { deckColor } from "../deck-tint";
import { type Card, type Deck, isOffered } from "../library";
import { leaveThen } from "@/design/use-back-entry";
import { characters, maxDescriptionLength, parseDisplayName } from "../publishing";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { Sheet } from "@/design/sheet";
import { DeckAppearanceFields, type Look, lookedTile, setPhoto } from "./deck-appearance";
import { DeckTile } from "./deck-tile";
import { raised, RowMenu } from "@/design/row-menu";

/** The user's display name as the page read it, or `unread` where it could not be. */
export type DisplayNameRead = { name: string | null } | "unread";

type Sheet = "rename" | "decorate" | "publish" | "delete";

const field =
  "min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink";
const primary = `${buttonClass("primary", "cta")} w-full`;
const secondary = buttonClass("secondary");

/**
 * The note page's ⋯, "노트 설정", as the phone's deck screen has it: "이름 바꾸기", "노트 꾸미기",
 * "노트 공개" or "비공개로 전환", and "노트 삭제" in red, each opening the phone's sheet or, for
 * making it private, acting at once; what was done, or what failed, is said in a snack bar. While
 * [cards] holds any, "Anki로 내보내기" downloads them as Anki's plain text (ADR 0222).
 */
export function NoteSettings({
  deck,
  cardCount,
  displayName,
  refusal,
  cards = [],
}: {
  deck: Deck;
  cardCount: number;
  cards?: Card[];
  displayName: DisplayNameRead;
  /** Why the note was refused, in one sentence, as the note page read it; none for any other note. */
  refusal?: string;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    if (snack === null) return;
    // The phone's snack bar stays four seconds.
    const timer = setTimeout(() => {
      setSnack(null);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [snack]);
  const close = () => {
    setSheet(null);
  };
  /** Closes the sheet over the note as the server now has it, saying [said] when given. */
  const done = (said?: string) => {
    setSheet(null);
    if (said) setSnack(said);
  };
  return (
    <>
      <RowMenu
        label="노트 설정"
        trigger={raised}
        items={[
          {
            label: "이름 바꾸기",
            pick: () => {
              setSheet("rename");
            },
          },
          {
            label: "노트 꾸미기",
            pick: () => {
              setSheet("decorate");
            },
          },
          isOffered(deck.publication)
            ? {
                label: "비공개로 전환",
                pick: () => {
                  start(async () => {
                    const result = await unpublishDeck(deck.id);
                    if (result.saved) done("노트를 비공개로 전환했어요");
                    else setSnack(result.message);
                  });
                },
              }
            : {
                label: "노트 공개",
                pick: () => {
                  setSheet("publish");
                },
              },
          ...(cards.length > 0
            ? [
                {
                  label: "Anki로 내보내기",
                  pick: () => {
                    setSnack(downloadAnki(deck.name, cards));
                  },
                },
              ]
            : []),
          {
            label: "노트 삭제",
            danger: true,
            pick: () => {
              setSheet("delete");
            },
          },
        ]}
      />
      {sheet === "rename" && <RenameSheet deck={deck} close={close} done={done} />}
      {sheet === "decorate" && <DecorateSheet deck={deck} close={close} done={done} />}
      {sheet === "publish" && (
        <PublishSheet
          deck={deck}
          displayName={displayName}
          refusal={refusal}
          close={close}
          done={done}
        />
      )}
      {sheet === "delete" && <DeleteSheet deck={deck} cardCount={cardCount} close={close} />}
      {snack && (
        <div className="pointer-events-none fixed inset-x-gutter bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex justify-center lg:bottom-6">
          <p
            role="status"
            className="max-w-list rounded-button bg-ink px-4 py-3 text-secondary text-on-ink shadow-raised"
          >
            {snack}
          </p>
        </div>
      )}
    </>
  );
}

/** Downloads [cards] as `<name>.txt` for Anki, and says what was written and what was not. */
function downloadAnki(name: string, cards: Card[]): string {
  const { text, basic, cloze, flattened, skipped } = ankiNotes(name, cards);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]/gu, "_")}.txt`;
  link.click();
  URL.revokeObjectURL(url);
  const notes = `카드 ${String(basic + cloze)}장을 내보냈어요`;
  const extra = [
    flattened > 0 && `${String(flattened)}장은 글만 담았어요`,
    skipped > 0 && `${String(skipped)}장은 글이 없어 뺐어요`,
  ].filter(Boolean);
  return extra.length > 0 ? `${notes}. ${extra.join(", ")}` : notes;
}

/** A sheet's problem, in red under its fields, read as it appears. */
function Problem({ children }: { children: string }) {
  return (
    <p role="alert" className="text-caption text-dont-know-text">
      {children}
    </p>
  );
}

/** "노트 이름 바꾸기": the name, one field, over "저장", as the phone's name sheet. */
function RenameSheet({ deck, close, done }: { deck: Deck; close: () => void; done: () => void }) {
  const [name, setName] = useState(deck.name);
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet title="노트 이름 바꾸기" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setProblem("이름을 입력해 주세요");
            return;
          }
          start(async () => {
            const result = await renameDeck(deck.id, name);
            if (result.saved) done();
            else setProblem(result.message);
          });
        }}
        className="flex flex-col gap-4 pb-2"
      >
        <label className="flex flex-col gap-2 text-caption text-muted">
          노트 이름
          <input
            autoFocus
            maxLength={500}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className={field}
          />
        </label>
        {problem && <Problem>{problem}</Problem>}
        <button disabled={pending} className={primary}>
          저장
        </button>
      </form>
    </Sheet>
  );
}

/**
 * "노트 꾸미기", as the phone's sheet: the tile previewing the choice at twice its size over the
 * choices 새 노트 offers (`DeckAppearanceFields`), over "저장", which stores them (ADR 0159). A
 * failure is said under the photo's buttons and the note stays as it was.
 */
function DecorateSheet({ deck, close, done }: { deck: Deck; close: () => void; done: () => void }) {
  const [look, setLook] = useState<Look>({
    icon: parseDeckIcon(deck.icon) ?? "layers",
    color: deckColor(deck),
    photo: deck.imageUrl ? { kind: "stored" } : { kind: "none" },
  });
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  function save() {
    const form = new FormData();
    form.set("deck", deck.id);
    form.set("icon", look.icon);
    form.set("color", look.color ?? "");
    setPhoto(form, look.photo);
    setProblem("");
    start(async () => {
      const result = await decorateDeck(form);
      if (result.saved) done();
      else setProblem(result.message);
    });
  }
  return (
    <Sheet title="노트 꾸미기" close={close}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex justify-center">
          <DeckTile
            deck={lookedTile(look, deck.imageUrl)}
            size="size-[calc(var(--spacing-deck-tile)*2)]"
          />
        </div>
        <DeckAppearanceFields
          look={look}
          change={(next) => {
            setLook(next);
            setProblem("");
          }}
          busy={pending}
          problem={problem}
        />
        <button type="button" disabled={pending} onClick={save} className={primary}>
          저장
        </button>
      </div>
    </Sheet>
  );
}

/**
 * `"name" 공개`, as the phone's publish sheet: the display name the first time, with the line
 * saying where it shows, an optional description of at most 300 characters, and the agreement,
 * which "공개" requires. A name that could not be read offers "다시 시도".
 */
function PublishSheet({
  deck,
  displayName,
  refusal,
  close,
  done,
}: {
  deck: Deck;
  displayName: DisplayNameRead;
  refusal?: string;
  close: () => void;
  done: (said: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState(deck.description ?? "");
  const [agreed, setAgreed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const nameError = useId();
  const descriptionError = useId();
  const title = `"${deck.name}" 공개`;
  if (displayName === "unread") {
    return (
      <Sheet title={title} close={close}>
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-secondary text-muted">
            지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => {
              router.refresh();
            }}
            className={`${secondary} justify-center`}
          >
            다시 시도
          </button>
        </div>
      </Sheet>
    );
  }
  if (waiting) {
    return (
      <Sheet title={title} close={close}>
        <div className="flex flex-col gap-4 pb-2">
          <p role="status" className="text-body text-ink">
            {problem}
          </p>
          <button type="button" onClick={close} className={`${secondary} justify-center`}>
            확인
          </button>
        </div>
      </Sheet>
    );
  }
  const askName = displayName.name === null;
  const nameInvalid = showErrors && askName && parseDisplayName(name) === null;
  const tooLong = characters(description.trim()) > maxDescriptionLength;
  return (
    <Sheet title={title} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if ((askName && parseDisplayName(name) === null) || tooLong) {
            setShowErrors(true);
            return;
          }
          if (busy.current) return;
          busy.current = true;
          setProblem("");
          start(async () => {
            const result = await publishDeck(deck.id, description, askName ? name : undefined);
            busy.current = false;
            if (result.saved) done("노트를 공개했어요");
            else {
              setProblem(result.message);
              setWaiting(result.waiting === true);
            }
          });
        }}
        className="flex flex-col gap-4 pb-2"
      >
        {refusal !== undefined && problem === "" && <Problem>{refusal}</Problem>}
        {askName && (
          <>
            <p className="text-secondary text-muted">
              공개한 노트에 이 이름이 표시돼요. 이메일은 표시되지 않아요.
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-2 text-caption text-muted">
                공개 이름
                <input
                  value={name}
                  aria-invalid={nameInvalid}
                  aria-describedby={nameInvalid ? nameError : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  className={field}
                />
              </label>
              {nameInvalid && (
                <p id={nameError} className="text-caption text-dont-know-text">
                  2~20자로 입력해 주세요
                </p>
              )}
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2 text-caption text-muted">
            설명 (선택)
            <textarea
              rows={2}
              value={description}
              aria-invalid={tooLong}
              aria-describedby={tooLong ? descriptionError : undefined}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              className={`${field} min-h-24 field-padding`}
            />
          </label>
          {tooLong && (
            <p id={descriptionError} className="text-caption text-dont-know-text">
              {maxDescriptionLength}자 이내로 입력해 주세요
            </p>
          )}
        </div>
        <label className="flex min-h-tap-target cursor-pointer items-start gap-3 text-body text-ink">
          <input
            type="checkbox"
            checked={agreed}
            disabled={pending}
            onChange={(event) => {
              setAgreed(event.target.checked);
            }}
            className="mt-1 size-5 shrink-0 accent-ink"
          />
          <span className="break-keep">
            부적절하거나 저작권을 침해하는 내용은 공개하지 않을게요
          </span>
        </label>
        {problem && <Problem>{problem}</Problem>}
        <button disabled={!agreed || pending} className={primary}>
          공개
        </button>
      </form>
    </Sheet>
  );
}

/**
 * The question before deleting a note, as the phone's `showAppConfirm`: its name in the title,
 * what goes with it in one sentence, "취소" and, last, a red "삭제"; a deletion leaves the dialog's
 * entry before it opens 홈.
 */
function DeleteSheet({
  deck,
  cardCount,
  close,
}: {
  deck: Deck;
  cardCount: number;
  close: () => void;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  return (
    <Confirm
      title={`"${deck.name}" 노트를 삭제할까요?`}
      consequence={
        cardCount === 0
          ? "이 노트에는 카드가 없어요."
          : `카드 ${String(cardCount)}장도 함께 삭제돼요.`
      }
      confirmLabel="삭제"
      destructive
      pending={pending}
      onConfirm={() => {
        start(async () => {
          const result = await deleteDeck(deck.id);
          if (result.deleted)
            leaveThen(() => {
              close();
              router.push("/decks");
            });
          else setProblem(result.message);
        });
      }}
      close={close}
    >
      {problem && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
    </Confirm>
  );
}
