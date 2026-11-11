"use client";

import { useState } from "react";

import { raised, RowMenu } from "@/design/row-menu";

import { AnkiImport } from "./anki-import";
import { AuthoringButton } from "./authoring-button";

/**
 * The 노트 page's actions, as the phone's 노트 tab has them: "+ 새 노트" and the ⋯, "노트 메뉴",
 * whose "Anki에서 가져오기" reads an Anki package into notes (ADR 0222).
 */
export function NotesMenu() {
  const [anki, setAnki] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <AuthoringButton />
      <RowMenu
        label="노트 메뉴"
        trigger={raised}
        items={[
          {
            label: "Anki에서 가져오기",
            pick: () => {
              setAnki(true);
            },
          },
        ]}
      />
      {anki && (
        <AnkiImport
          close={() => {
            setAnki(false);
          }}
        />
      )}
    </span>
  );
}
