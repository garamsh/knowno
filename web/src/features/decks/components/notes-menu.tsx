"use client";

import { useState } from "react";

import { raised, RowMenu } from "@/design/row-menu";

import { AnkiImport } from "./anki-import";
import { AuthoringSheets, type AuthoringScreen } from "./authoring-sheets";

/**
 * The 노트 page's ⋯, "노트 메뉴", as the phone's 노트 tab has it (#722): "직접 추가", which opens
 * 새 노트 to make a note by hand, where 말랑이 is the way to make one by default, and "Anki에서
 * 가져오기", which reads an Anki package into notes (ADR 0222).
 */
export function NotesMenu() {
  const [screen, setScreen] = useState<AuthoringScreen | null>(null);
  const [anki, setAnki] = useState(false);
  return (
    <>
      <RowMenu
        label="노트 메뉴"
        trigger={raised}
        items={[
          {
            label: "직접 추가",
            pick: () => {
              setScreen("name");
            },
          },
          {
            label: "Anki에서 가져오기",
            pick: () => {
              setAnki(true);
            },
          },
        ]}
      />
      <AuthoringSheets screen={screen} setScreen={setScreen} />
      {anki && (
        <AnkiImport
          close={() => {
            setAnki(false);
          }}
        />
      )}
    </>
  );
}
