"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Deck } from "../library";
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

/** Where the authoring flow is: the ways to add a card, a hand-made card, a file, or a new note's name. */
export type AuthoringScreen = "options" | "manual" | "file" | "name";

/**
 * The screens of adding by hand (#722), opened from a ⋯ menu's "직접 추가": with [deck], the 카드
 * 추가 sheet of the ways to add a card (ADR 0150) and what each opens; without one, 새 노트. The
 * menu owns [screen], and [setScreen] closes with null.
 */
export function AuthoringSheets({
  deck,
  screen,
  setScreen,
}: {
  deck?: Deck;
  screen: AuthoringScreen | null;
  setScreen: (screen: AuthoringScreen | null) => void;
}) {
  const imports = usePhotoImports();
  const router = useRouter();
  // An import left reading outlives this flow; its other ways open here while it is shown, else
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
