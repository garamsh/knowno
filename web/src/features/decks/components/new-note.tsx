"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { createDeck, decorateDeck } from "../actions";
import { leaveThen } from "@/design/use-back-entry";
import { buttonClass } from "@/design/button";
import { AuthoringScreen, pairClass } from "./authoring-sheet";
import { DeckAppearanceFields, type Look, lookedTile, setPhoto } from "./deck-appearance";
import { DeckTile } from "./deck-tile";

/**
 * 새 노트, the shape of 새 카드 (ADR 0150), as the phone's: the tile the note will get, at twice its
 * size, over its name as typed; "노트 이름" in a group, focused, with its hint; and 노트 꾸미기's
 * choices (`DeckAppearanceFields`), blue first; over "저장", which opens the new note, and
 * "저장하고 카드 추가", which opens it with its 카드 추가 sheet up. An icon or a photo chosen is
 * stored as 노트 꾸미기 stores it, once the note is made; a retry keeps the note's id, so it makes
 * no second note.
 */
export function NewNote({ close }: { close: () => void }) {
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
