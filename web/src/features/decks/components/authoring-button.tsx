"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Deck } from "../library";
import { buttonClass } from "@/design/button";
import { Sheet } from "@/design/sheet";
import { CardEditor } from "./card-editor";
import { NewNote } from "./new-note";
import { usePhotoImports } from "./photo-imports";
import { SpreadsheetImport } from "./spreadsheet-import";

// The ways to add a card, each its name alone (ADR 0150): the web has all four.
const choices = [
  { choice: "직접 입력", open: "manual" },
  { choice: "사진 찍기", open: "camera" },
  { choice: "앨범에서 고르기", open: "album" },
  { choice: "엑셀·CSV 파일", open: "file" },
] as const;

/**
 * With [deck], "+ 카드 추가" beside the note's ⋯, which opens the 카드 추가 sheet of the ways to add
 * a card (ADR 0150) and what each opens, open on arrival with [adding]. Without one, "+ 새 노트"
 * beside the 노트 page's title, which opens 새 노트. It is the page's own action in the tonal fill,
 * the brand tint under an accent label on the edge a quiet button sits on, 44 high, as the phone's
 * header action.
 */
export function AuthoringButton({ deck, adding = false }: { deck?: Deck; adding?: boolean }) {
  const [screen, setScreen] = useState<"options" | "manual" | "file" | "name" | null>(
    deck && adding ? "options" : null,
  );
  const imports = usePhotoImports();
  const router = useRouter();
  // An import left reading outlives this button; its other ways open here while it is shown, else
  // on the note's page with its 카드 추가 sheet up.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setScreen(deck ? "options" : "name");
        }}
        className={`${buttonClass("tonal", "header")} shrink-0`}
      >
        <Plus aria-hidden className="size-5" strokeWidth={2.6} />
        {deck ? "카드 추가" : "새 노트"}
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
              (open === "camera" || open === "album") && imports.open ? (
                // One import at a time: while one is under way, the photo rows open it.
                <button
                  type="button"
                  key={choice}
                  className="pressable flex min-h-cta w-full items-center rounded-row bg-surface px-4 text-left text-body-strong"
                  onClick={() => {
                    setScreen(null);
                    imports.open?.();
                  }}
                >
                  {choice}
                </button>
              ) : open === "camera" || open === "album" ? (
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
                      setScreen(null);
                      imports.start(deck, open === "camera", chosen, (way) => {
                        if (mounted.current) setScreen(way);
                        else router.push(`/decks/${deck.id}?adding=1`);
                      });
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
    </>
  );
}
