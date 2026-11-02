"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { decorateDeck, deleteDeck, publishDeck, renameDeck, unpublishDeck } from "../actions";
import { type DeckIcon, deckIconNames, deckIcons, parseDeckIcon } from "../deck-icon";
import { type DeckColor, deckColor } from "../deck-tint";
import type { Deck } from "../library";
import { leaveThen } from "../hooks/use-back-entry";
import { cropImage, type PreparedImage } from "../prepare-image";
import { characters, maxDescriptionLength, parseDisplayName } from "../publishing";
import { AuthoringSheet } from "./authoring-sheet";
import { DeckColorPicker } from "./deck-color-picker";
import { DeckTile, IconDrawing } from "./deck-tile";
import { RowMenu } from "./row-menu";

/** The user's display name as the page read it, or `unread` where it could not be. */
export type DisplayNameRead = { name: string | null } | "unread";

type Sheet = "rename" | "decorate" | "publish" | "delete";

const field =
  "min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink";
const primary =
  "pressable min-h-cta w-full rounded-button bg-primary px-5 text-button text-on-primary disabled:opacity-50";
const secondary =
  "pressable flex min-h-button cursor-pointer items-center rounded-button bg-surface px-4 text-button focus-within:outline-2 focus-within:outline-ink";

/**
 * The note page's ⋯, "노트 설정", as the phone's deck screen has it: "이름 바꾸기", "노트 꾸미기",
 * "노트 공개" or "비공개로 전환", and "노트 삭제" in red, each opening the phone's sheet or, for
 * making it private, acting at once; what was done, or what failed, is said in a snack bar.
 */
export function NoteSettings({
  deck,
  cardCount,
  displayName,
}: {
  deck: Deck;
  cardCount: number;
  displayName: DisplayNameRead;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const router = useRouter();
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
    router.refresh();
  };
  return (
    <>
      <RowMenu
        label="노트 설정"
        trigger="pressable flex size-tap-target shrink-0 items-center justify-center rounded-chip bg-surface text-ink shadow-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
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
          deck.public
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
        <PublishSheet deck={deck} displayName={displayName} close={close} done={done} />
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
    <AuthoringSheet title="노트 이름 바꾸기" close={close}>
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
    </AuthoringSheet>
  );
}

/** The photo 노트 꾸미기 holds: the deck's own, none, or one picked and not yet stored. */
type Photo =
  { kind: "stored" } | { kind: "none" } | { kind: "picked"; image: PreparedImage; url: string };

/**
 * "노트 꾸미기", as the phone's sheet: the tile previewing the choice at twice its size, the icons,
 * the colours and the photo, picked from the album or the camera and cropped to its centred
 * square, or removed, over "저장", which stores them (ADR 0159). A failure is said under the photo's
 * buttons and the note stays as it was.
 */
function DecorateSheet({ deck, close, done }: { deck: Deck; close: () => void; done: () => void }) {
  const [icon, setIcon] = useState<DeckIcon>(parseDeckIcon(deck.icon) ?? "layers");
  const [color, setColor] = useState<DeckColor | undefined>(deckColor(deck));
  const [photo, setPhoto] = useState<Photo>(deck.imageUrl ? { kind: "stored" } : { kind: "none" });
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const iconLegend = useId();
  const pickedUrl = photo.kind === "picked" ? photo.url : null;
  useEffect(
    () => () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );
  const busy = pending || picking;
  const preview: Deck = {
    ...deck,
    icon,
    color,
    imageUrl:
      photo.kind === "picked" ? photo.url : photo.kind === "stored" ? deck.imageUrl : undefined,
  };
  async function pick(file: File | undefined) {
    if (!file) return;
    setPicking(true);
    setProblem("");
    const image = await cropImage(file);
    setPicking(false);
    if (!image) {
      setProblem("사진을 불러오지 못했어요. 다시 시도해 주세요.");
      return;
    }
    setPhoto({ kind: "picked", image, url: URL.createObjectURL(image.jpeg) });
  }
  function save() {
    const form = new FormData();
    form.set("deck", deck.id);
    form.set("icon", icon);
    form.set("color", color ?? "");
    if (photo.kind === "picked") {
      form.set("image", photo.image.jpeg, "image.jpg");
      form.set("sha256", photo.image.sha256);
    } else form.set("image", photo.kind === "stored" ? "keep" : "remove");
    setProblem("");
    start(async () => {
      const result = await decorateDeck(form);
      if (result.saved) done();
      else setProblem(result.message);
    });
  }
  return (
    <AuthoringSheet title="노트 꾸미기" close={close}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex justify-center">
          <DeckTile deck={preview} size="size-[calc(var(--spacing-deck-tile)*2)]" />
        </div>
        <fieldset
          aria-labelledby={iconLegend}
          className="flex flex-col gap-3 rounded-group bg-surface px-4 py-4"
        >
          <span id={iconLegend} className="text-caption text-muted">
            아이콘
          </span>
          <div className="flex flex-wrap gap-2">
            {deckIcons.map((offered) => (
              <label
                key={offered}
                className="flex size-[calc(var(--spacing-tap-target)+4px)] cursor-pointer items-center justify-center rounded-field border border-outline bg-surface text-ink has-checked:border-2 has-checked:border-accent has-checked:bg-brand-tint has-focus-visible:outline-2 has-focus-visible:outline-ink"
              >
                <input
                  type="radio"
                  name="icon"
                  value={offered}
                  aria-label={deckIconNames[offered]}
                  checked={icon === offered}
                  onChange={() => {
                    setIcon(offered);
                  }}
                  className="sr-only"
                />
                <IconDrawing icon={offered} className="size-6" />
              </label>
            ))}
          </div>
        </fieldset>
        <DeckColorPicker legend="색" selected={color} pick={setColor} />
        <div
          role="group"
          aria-label="사진 넣기"
          className="flex flex-col gap-3 rounded-group bg-surface px-4 py-4"
        >
          <span aria-hidden className="text-caption text-muted">
            사진 넣기
          </span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["앨범에서 고르기", false],
                ["사진 찍기", true],
              ] as const
            ).map(([label, camera]) => (
              <label
                key={label}
                className={`${secondary} border border-outline ${busy ? "pointer-events-none opacity-50" : ""}`}
              >
                {label}
                <input
                  aria-label={label}
                  type="file"
                  accept="image/*"
                  capture={camera ? "environment" : undefined}
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void pick(file);
                  }}
                  className="sr-only"
                />
              </label>
            ))}
            {photo.kind !== "none" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPhoto({ kind: "none" });
                }}
                className="pressable min-h-button px-3 text-button text-ink-2 disabled:opacity-50"
              >
                사진 빼기
              </button>
            )}
          </div>
          {problem && <Problem>{problem}</Problem>}
        </div>
        <button type="button" disabled={busy} onClick={save} className={primary}>
          저장
        </button>
      </div>
    </AuthoringSheet>
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
  close,
  done,
}: {
  deck: Deck;
  displayName: DisplayNameRead;
  close: () => void;
  done: (said: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState(deck.description ?? "");
  const [agreed, setAgreed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const nameError = useId();
  const descriptionError = useId();
  const title = `"${deck.name}" 공개`;
  if (displayName === "unread") {
    return (
      <AuthoringSheet title={title} close={close}>
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
      </AuthoringSheet>
    );
  }
  const askName = displayName.name === null;
  const nameInvalid = showErrors && askName && parseDisplayName(name) === null;
  const tooLong = characters(description.trim()) > maxDescriptionLength;
  return (
    <AuthoringSheet title={title} close={close}>
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
            else setProblem(result.message);
          });
        }}
        className="flex flex-col gap-4 pb-2"
      >
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
              className={`${field} min-h-24 py-[calc((var(--spacing-field)-var(--text-body--line-height))/2)]`}
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
    </AuthoringSheet>
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
    <AuthoringSheet title={`"${deck.name}" 노트를 삭제할까요?`} close={close}>
      <p className="text-secondary text-muted">
        {cardCount === 0
          ? "이 노트에는 카드가 없어요."
          : `카드 ${String(cardCount)}장도 함께 삭제돼요.`}
      </p>
      {problem && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" onClick={close} className="pressable min-h-button text-body">
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const result = await deleteDeck(deck.id);
              if (result.deleted)
                leaveThen(() => {
                  close();
                  router.push("/");
                  router.refresh();
                });
              else setProblem(result.message);
            });
          }}
          className="pressable min-h-button rounded-button bg-dont-know px-4 text-button text-on-ink disabled:opacity-50"
        >
          삭제
        </button>
      </div>
    </AuthoringSheet>
  );
}
